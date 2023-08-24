import type { ISourceOptions } from "@tsparticles/engine";

const options: ISourceOptions = {
    name: "Text Mask Multiline",
    smooth: true,
    interactivity: {
        events: {
            onHover: {
                enable: true,
                mode: "bubble",
                parallax: {
                    enable: false,
                    force: 2,
                    smooth: 10,
                },
            },
        },
        modes: {
            bubble: {
                distance: 40,
                duration: 2,
                opacity: 8,
                size: 15,
            },
        },
    },
    particles: {
        move: {
            direction: "none",
            distance: 2,
            enable: true,
            speed: 1,
        },
        number: {
            value: 600,
        },
        color: {
            value: "random",
        },
        shape: {
            type: ["circle", "square", "triangle"],
        },
        size: {
            value: {
                min: 1,
                max: 3,
            },
        },
    },
    canvasMask: {
        enable: true,
        override: {
            color: false,
        },
        scale: 1,
        pixels: {
            filter: "pixelTextFilter",
        },
        position: {
            x: 50,
            y: 50,
        },
        text: {
            color: "#ff0000",
            font: {
                size: 300,
            },
            text: "Hello\nWorld\nHello\nWorld",
            lines: {
                spacing: 50,
            },
        },
    },
    background: {
        color: "#000000",
        image: "",
        position: "50% 50%",
        repeat: "no-repeat",
        size: "cover",
    },
};

export default options;
