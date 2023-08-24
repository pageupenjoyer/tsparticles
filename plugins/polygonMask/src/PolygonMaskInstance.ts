import {
    type Engine,
    type IContainerPlugin,
    type ICoordinates,
    type IDelta,
    type IDimension,
    OutModeDirection,
    type Particle,
    deepExtend,
    errorPrefix,
    getDistance,
    getDistances,
    getRandom,
    isArray,
    isString,
    itemFromArray,
} from "@tsparticles/engine";
import { calcClosestPtOnSegment, drawPolygonMask, drawPolygonMaskPath, parsePaths, segmentBounce } from "./utils";
import type { ISvgPath } from "./Interfaces/ISvgPath";
import type { PolygonMaskContainer } from "./types";
import { PolygonMaskInlineArrangement } from "./Enums/PolygonMaskInlineArrangement";
import { PolygonMaskType } from "./Enums/PolygonMaskType";

const noPolygonDataLoaded = `${errorPrefix} No polygon data loaded.`,
    noPolygonFound = `${errorPrefix} No polygon found, you need to specify SVG url in config.`;

/**
 * Polygon Mask manager
 */
export class PolygonMaskInstance implements IContainerPlugin {
    dimension: IDimension;
    offset?: ICoordinates;
    paths?: ISvgPath[];
    raw?: ICoordinates[];
    redrawTimeout?: number;

    private readonly _container;
    private readonly _engine;
    private _moveRadius;
    private _scale;

    constructor(container: PolygonMaskContainer, engine: Engine) {
        this._container = container;
        this._engine = engine;
        this.dimension = {
            height: 0,
            width: 0,
        };
        this._moveRadius = 0;
        this._scale = 1;
    }

    clickPositionValid(position: ICoordinates): boolean {
        const options = this._container.actualOptions.polygon;

        return (
            !!options?.enable &&
            options.type !== PolygonMaskType.none &&
            options.type !== PolygonMaskType.inline &&
            this._checkInsidePolygon(position)
        );
    }

    draw(context: CanvasRenderingContext2D): void {
        if (!this.paths?.length) {
            return;
        }

        const options = this._container.actualOptions.polygon;

        if (!options?.enable) {
            return;
        }

        const polygonDraw = options.draw;

        if (!polygonDraw.enable) {
            return;
        }

        const rawData = this.raw;

        for (const path of this.paths) {
            const path2d = path.path2d;

            if (!context) {
                continue;
            }

            if (path2d && this.offset) {
                drawPolygonMaskPath(context, path2d, polygonDraw.stroke, this.offset);
            } else if (rawData) {
                drawPolygonMask(context, rawData, polygonDraw.stroke);
            }
        }
    }

    async init(): Promise<void> {
        const container = this._container,
            polygonMaskOptions = container.actualOptions.polygon,
            pxRatio = container.retina.pixelRatio;

        if (!polygonMaskOptions) {
            return;
        }

        this._moveRadius = polygonMaskOptions.move.radius * pxRatio;
        this._scale = polygonMaskOptions.scale * pxRatio;

        /* If is set the url of svg element, load it and parse into raw polygon data */
        if (polygonMaskOptions.enable) {
            await this._initRawData();
        }
    }

    particleBounce(particle: Particle, delta: IDelta, direction: OutModeDirection): boolean {
        return this._polygonBounce(particle, delta, direction);
    }

    particlePosition(position?: ICoordinates): ICoordinates | undefined {
        const options = this._container.actualOptions.polygon;

        if (!(options?.enable && (this.raw?.length ?? 0) > 0)) {
            return;
        }

        return deepExtend({}, position ? position : this._randomPoint()) as ICoordinates;
    }

    particlesInitialization(): boolean {
        const options = this._container.actualOptions.polygon;

        if (
            options?.enable &&
            options.type === PolygonMaskType.inline &&
            (options.inline.arrangement === PolygonMaskInlineArrangement.onePerPoint ||
                options.inline.arrangement === PolygonMaskInlineArrangement.perPoint)
        ) {
            this._drawPoints();

            return true;
        }

        return false;
    }

    resize(): void {
        const container = this._container,
            options = container.actualOptions.polygon;

        if (!(options?.enable && options.type !== PolygonMaskType.none)) {
            return;
        }

        if (this.redrawTimeout) {
            clearTimeout(this.redrawTimeout);
        }

        this.redrawTimeout = window.setTimeout(async () => {
            await this._initRawData(true);

            await container.particles.redraw();
        }, 250);
    }

    stop(): void {
        delete this.raw;
        delete this.paths;
    }

    private readonly _checkInsidePolygon: (position?: ICoordinates) => boolean = (position) => {
        const container = this._container,
            options = container.actualOptions.polygon;

        if (!options?.enable || options.type === PolygonMaskType.none || options.type === PolygonMaskType.inline) {
            return true;
        }

        // https://github.com/substack/point-in-polygon
        // ray-casting algorithm based on
        // http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html
        if (!this.raw) {
            throw new Error(noPolygonFound);
        }

        const canvasSize = container.canvas.size,
            x = position?.x ?? getRandom() * canvasSize.width,
            y = position?.y ?? getRandom() * canvasSize.height;

        let inside = false;

        // if (this.polygonPath && position) {
        //     inside = container.canvas.isPointInPath(this.polygonPath, position);
        // } else {
        for (let i = 0, j = this.raw.length - 1; i < this.raw.length; j = i++) {
            const pi = this.raw[i],
                pj = this.raw[j],
                intersect = pi.y > y !== pj.y > y && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x;

            if (intersect) {
                inside = !inside;
            }
        }
        // }

        return options.type === PolygonMaskType.inside
            ? inside
            : options.type === PolygonMaskType.outside
            ? !inside
            : false;
    };

    private readonly _createPath2D: () => void = () => {
        const container = this._container,
            options = container.actualOptions.polygon;

        if (!options || !this.paths?.length) {
            return;
        }

        for (const path of this.paths) {
            const pathData = path.element?.getAttribute("d");

            if (pathData) {
                const path2d = new Path2D(pathData),
                    matrix = document.createElementNS("http://www.w3.org/2000/svg", "svg").createSVGMatrix(),
                    finalPath = new Path2D(),
                    transform = matrix.scale(this._scale);

                if (finalPath.addPath) {
                    finalPath.addPath(path2d, transform);

                    path.path2d = finalPath;
                } else {
                    delete path.path2d;
                }
            } else {
                delete path.path2d;
            }

            if (path.path2d || !this.raw) {
                continue;
            }

            path.path2d = new Path2D();
            path.path2d.moveTo(this.raw[0].x, this.raw[0].y);

            this.raw.forEach((pos, i) => {
                if (i > 0) {
                    path.path2d?.lineTo(pos.x, pos.y);
                }
            });

            path.path2d.closePath();
        }
    };

    /**
     * Deprecate SVGPathElement.getPathSegAtLength removed in:
     * Chrome for desktop release 62
     * Chrome for Android release 62
     * Android WebView release 62
     * Opera release 49
     * Opera for Android release 49
     * @param svgUrl -
     * @param force -
     * @returns the coordinates of the polygon
     */
    private readonly _downloadSvgPath: (svgUrl?: string, force?: boolean) => Promise<ICoordinates[] | undefined> =
        async (svgUrl, force) => {
            const options = this._container.actualOptions.polygon;

            if (!options) {
                return;
            }

            const url = svgUrl || options.url,
                forceDownload = force ?? false;

            // Load SVG from file on server
            if (!url || (this.paths !== undefined && !forceDownload)) {
                return this.raw;
            }

            const req = await fetch(url);

            if (!req.ok) {
                throw new Error(`${errorPrefix} occurred during polygon mask download`);
            }

            return this._parseSvgPath(await req.text(), force);
        };

    private readonly _drawPoints: () => void = () => {
        if (!this.raw) {
            return;
        }

        for (const item of this.raw) {
            this._container.particles.addParticle({
                x: item.x,
                y: item.y,
            });
        }
    };

    private readonly _getEquidistantPointByIndex: (index: number) => ICoordinates | undefined = (index) => {
        const container = this._container,
            options = container.actualOptions,
            polygonMaskOptions = options.polygon;

        if (!polygonMaskOptions) {
            return;
        }

        if (!this.raw || !this.raw.length || !this.paths?.length) {
            throw new Error(noPolygonDataLoaded);
        }

        let offset = 0,
            point: DOMPoint | undefined;

        const totalLength = this.paths.reduce((tot: number, path: ISvgPath) => tot + path.length, 0),
            distance = totalLength / options.particles.number.value;

        for (const path of this.paths) {
            const pathDistance = distance * index - offset;

            if (pathDistance <= path.length) {
                point = path.element.getPointAtLength(pathDistance);

                break;
            } else {
                offset += path.length;
            }
        }

        const scale = this._scale;

        return {
            x: (point?.x ?? 0) * scale + (this.offset?.x ?? 0),
            y: (point?.y ?? 0) * scale + (this.offset?.y ?? 0),
        };
    };

    private readonly _getPointByIndex: (index: number) => ICoordinates = (index) => {
        if (!this.raw || !this.raw.length) {
            throw new Error(noPolygonDataLoaded);
        }

        const coords = this.raw[index % this.raw.length];

        return {
            x: coords.x,
            y: coords.y,
        };
    };

    private readonly _getRandomPoint: () => ICoordinates = () => {
        if (!this.raw || !this.raw.length) {
            throw new Error(noPolygonDataLoaded);
        }

        const coords = itemFromArray(this.raw);

        return {
            x: coords.x,
            y: coords.y,
        };
    };

    private readonly _getRandomPointByLength: () => ICoordinates | undefined = () => {
        const container = this._container,
            options = container.actualOptions.polygon;

        if (!options) {
            return;
        }

        if (!this.raw || !this.raw.length || !this.paths?.length) {
            throw new Error(noPolygonDataLoaded);
        }

        const path = itemFromArray(this.paths),
            distance = Math.floor(getRandom() * path.length) + 1,
            point = path.element.getPointAtLength(distance),
            scale = this._scale;

        return {
            x: point.x * scale + (this.offset?.x || 0),
            y: point.y * scale + (this.offset?.y || 0),
        };
    };

    private readonly _initRawData: (force?: boolean) => Promise<void> = async (force) => {
        const options = this._container.actualOptions.polygon;

        if (!options) {
            return;
        }

        if (options.url) {
            this.raw = await this._downloadSvgPath(options.url, force);
        } else if (options.data) {
            const data = options.data;

            let svg: string;

            if (isString(data)) {
                svg = data;
            } else {
                const getPath = (p: string): string => `<path d="${p}" />`,
                    path = isArray(data.path) ? data.path.map(getPath).join("") : getPath(data.path);

                const namespaces = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

                svg = `<svg ${namespaces} width="${data.size.width}" height="${data.size.height}">${path}</svg>`;
            }

            this.raw = this._parseSvgPath(svg, force);
        }

        this._createPath2D();

        this._engine.dispatchEvent("polygonMaskLoaded", {
            container: this._container,
        });
    };

    private readonly _parseSvgPath: (xml: string, force?: boolean) => ICoordinates[] | undefined = (xml, force) => {
        const forceDownload = force ?? false;

        if (this.paths !== undefined && !forceDownload) {
            return this.raw;
        }

        const container = this._container,
            options = container.actualOptions.polygon;

        if (!options) {
            return;
        }

        const parser = new DOMParser(),
            doc = parser.parseFromString(xml, "image/svg+xml"),
            svg = doc.getElementsByTagName("svg")[0];

        let svgPaths = svg.getElementsByTagName("path");

        if (!svgPaths.length) {
            svgPaths = doc.getElementsByTagName("path");
        }

        this.paths = [];

        for (let i = 0; i < svgPaths.length; i++) {
            const path = svgPaths.item(i);

            if (path) {
                this.paths.push({
                    element: path,
                    length: path.getTotalLength(),
                });
            }
        }

        const scale = this._scale;

        this.dimension.width = parseFloat(svg.getAttribute("width") ?? "0") * scale;
        this.dimension.height = parseFloat(svg.getAttribute("height") ?? "0") * scale;

        const position = options.position ?? {
                x: 50,
                y: 50,
            },
            canvasSize = container.canvas.size;

        /* centering of the polygon mask */
        this.offset = {
            x: (canvasSize.width * position.x) / 100 - this.dimension.width / 2,
            y: (canvasSize.height * position.y) / 100 - this.dimension.height / 2,
        };

        return parsePaths(this.paths, scale, this.offset);
    };

    private readonly _polygonBounce: (particle: Particle, delta: IDelta, direction: OutModeDirection) => boolean = (
        particle,
        _delta,
        direction,
    ) => {
        const options = this._container.actualOptions.polygon;

        if (!this.raw || !options?.enable || direction !== OutModeDirection.top) {
            return false;
        }

        if (options.type === PolygonMaskType.inside || options.type === PolygonMaskType.outside) {
            let closest: ICoordinates | undefined, dx: number | undefined, dy: number | undefined;
            const pos = particle.getPosition(),
                radius = particle.getRadius();

            for (let i = 0, j = this.raw.length - 1; i < this.raw.length; j = i++) {
                const pi = this.raw[i],
                    pj = this.raw[j];

                closest = calcClosestPtOnSegment(pi, pj, pos);

                const dist = getDistances(pos, closest);

                [dx, dy] = [dist.dx, dist.dy];

                if (dist.distance < radius) {
                    segmentBounce(pi, pj, particle.velocity);

                    return true;
                }
            }

            if (closest && dx !== undefined && dy !== undefined && !this._checkInsidePolygon(pos)) {
                const factor = { x: 1, y: 1 },
                    diameter = radius * 2;

                if (pos.x >= closest.x) {
                    factor.x = -1;
                }

                if (pos.y >= closest.y) {
                    factor.y = -1;
                }

                particle.position.x = closest.x + diameter * factor.x;
                particle.position.y = closest.y + diameter * factor.y;

                particle.velocity.mult(-1);

                return true;
            }
        } else if (options.type === PolygonMaskType.inline && particle.initialPosition) {
            const dist = getDistance(particle.initialPosition, particle.getPosition()),
                { velocity } = particle;

            if (dist > this._moveRadius) {
                velocity.x = velocity.y / 2 - velocity.x;
                velocity.y = velocity.x / 2 - velocity.y;

                return true;
            }
        }

        return false;
    };

    private readonly _randomPoint: () => ICoordinates | undefined = () => {
        const container = this._container,
            options = container.actualOptions.polygon;

        if (!options) {
            return;
        }

        let position: ICoordinates | undefined;

        if (options.type === PolygonMaskType.inline) {
            switch (options.inline.arrangement) {
                case PolygonMaskInlineArrangement.randomPoint:
                    position = this._getRandomPoint();
                    break;
                case PolygonMaskInlineArrangement.randomLength:
                    position = this._getRandomPointByLength();
                    break;
                case PolygonMaskInlineArrangement.equidistant:
                    position = this._getEquidistantPointByIndex(container.particles.count);
                    break;
                case PolygonMaskInlineArrangement.onePerPoint:
                case PolygonMaskInlineArrangement.perPoint:
                default:
                    position = this._getPointByIndex(container.particles.count);
            }
        } else {
            const canvasSize = container.canvas.size;

            position = {
                x: getRandom() * canvasSize.width,
                y: getRandom() * canvasSize.height,
            };
        }

        if (this._checkInsidePolygon(position)) {
            return position;
        } else {
            return this._randomPoint();
        }
    };
}
