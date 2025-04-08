
// UI variables involved in the reaction diffusion process
//

let settings = {
    feed: 0.0233,
    kill: 0.07,
    D_a: 0.562,
    D_b: 0.111
}

webglLessonsUI.setupUI(document.querySelector('#ui'), settings, [
    {
        type: 'slider', key: 'feed', name: 'Feed',
        min: 0.0, max: 0.1, step: 0.001,
        precision: 3, uiPrecision: 3, uiMult: 1,
        slide: (event, ui) => { settings.feed = ui.value; }
    },
    {
        type: 'slider', key: 'kill', name: 'Kill',
        min: 0.0, max: 0.1, step: 0.001,
        precision: 3, uiPrecision: 3, uiMult: 1,
        slide: (event, ui) => { settings.kill = ui.value; }
    },
    {
        type: 'slider', key: 'D_a', name: 'Diffusion Rate A',
        min: 0.0, max: 1.0, step: 0.001,
        precision: 3, uiPrecision: 3, uiMult: 1,
        slide: (event, ui) => { settings.D_a = ui.value; }
    },
    {
        type: 'slider', key: 'D_b', name: 'Diffusion Rate B',
        min: 0.0, max: 0.4, step: 0.01,
        precision: 2, uiPrecision: 2, uiMult: 1,
        slide: (event, ui) => { settings.D_b = ui.value; }
    }
]);