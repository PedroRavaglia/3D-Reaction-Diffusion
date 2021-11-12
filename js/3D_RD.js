
var canvas = document.getElementById("webgl-canvas");
var gl = canvas.getContext("webgl2");
if (!gl) console.log("Not ennable to run WebGL2 with this browser");

window.onresize = function() {
    app.resize(window.innerWidth, window.innerHeight);
}

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

var app = PicoGL.createApp(canvas)
.clearColor(0.0, 0.0, 0.0, 1.0)
.blendFunc(PicoGL.ONE, PicoGL.ONE_MINUS_SRC_ALPHA)
.clear();


// Shaders that will update the frame of reaction diffusion
const updateVert = `
#version 300 es
precision mediump float;

in vec2 position;

void main() {
    gl_Position = vec4(position, 0, 1);
}`

const updateFrag = `
#version 300 es
precision lowp sampler3D;
precision mediump float;

uniform sampler3D currState;
uniform float u_size;
uniform float layer;

layout(std140) uniform UpdateUniforms {
    float u_F;
    float u_K;
    float D_a;
    float D_b;
    float L_1;
    float L_2;
    float L_3;
    float L_4;
    int run;
};

const float D_t = 1.0;

out vec4 fragColor;
void main() {
    // vec3 position = vec3(gl_FragCoord.xy, layer);
    vec3 position = vec3(gl_FragCoord.xy, u_size - layer);
    // vec3 position = vec3(gl_FragCoord.xy, u_size/2.0);

    vec3 color = texture(currState, position / u_size).xyz;

    vec2 laplacian = 
        L_1  * color.xy

        + L_2  * texture(currState, (position + vec3( 0.0,  1.0,  0.0)) / u_size).xy
        + L_2  * texture(currState, (position + vec3( 0.0, -1.0,  0.0)) / u_size).xy
        + L_3  * texture(currState, (position + vec3( 1.0,  0.0,  0.0)) / u_size).xy
        + L_3  * texture(currState, (position + vec3(-1.0,  0.0,  0.0)) / u_size).xy
        + L_4  * texture(currState, (position + vec3( 0.0,  0.0,  1.0)) / u_size).xy
        + L_4  * texture(currState, (position + vec3( 0.0,  0.0, -1.0)) / u_size).xy
        
        + L_2  * texture(currState, (position + vec3( 1.0,  1.0,  1.0)) / u_size).xy
        + L_2  * texture(currState, (position + vec3(-1.0,  1.0,  1.0)) / u_size).xy
        + L_2  * texture(currState, (position + vec3(-1.0, -1.0,  1.0)) / u_size).xy
        + L_2  * texture(currState, (position + vec3( 1.0, -1.0,  1.0)) / u_size).xy

        + L_2  * texture(currState, (position + vec3( 1.0,  1.0, -1.0)) / u_size).xy
        + L_2  * texture(currState, (position + vec3(-1.0,  1.0, -1.0)) / u_size).xy
        + L_2  * texture(currState, (position + vec3(-1.0, -1.0, -1.0)) / u_size).xy
        + L_2  * texture(currState, (position + vec3( 1.0, -1.0, -1.0)) / u_size).xy
        ;

    float A = color.x + D_t * (D_a * laplacian.x - color.x * color.y * color.y + u_F * (1.0 - color.x));
    float B = color.y + D_t * (D_b * laplacian.y + color.x * color.y * color.y - (u_K + u_F) * color.y);

    if (run == 1) {
        fragColor = vec4(A, B, 0.0, 1.0);
    } 
}`


// Shaders to render points
const pointsVertex = `
#version 300 es
precision lowp sampler3D;

in vec4 position;

uniform mat4 uMVP;
uniform sampler3D tex;

out vec3 vUV;
void main() {
    vUV = position.xyz + 0.5;
    vec4 color = texture(tex, vUV);

    if (color.x < 0.2) {
        gl_Position = uMVP * position;
        gl_PointSize = 5.8;
    }
    
}`

const pointsFragment = `
#version 300 es
precision highp float;
precision lowp sampler3D;

in vec3 vUV;

uniform sampler3D tex;
uniform float u_size;

out vec4 fragColor;
void main() {
    vec4 color = texture(tex, vUV);

    float A = color.x;
    float B = color.y;

    // fragColor = texture(tex, vUV);
    // fragColor = vec4 (color.xyz, 1.0);
    // fragColor = vec4 (color.x, color.x, color.x, 1.0);
    // fragColor = vec4(A-B, A-B, A-B, 1.0);
    fragColor = vec4(vUV.x, vUV.y, vUV.z, 1.0);
    // fragColor = vec4(vUV.z, vUV.z, vUV.z, 1.0);
}`



// Geometry data:
//
var quadPositions = app.createVertexBuffer(PicoGL.FLOAT, 2, new Float32Array([
    -1.0,  1.0, 
     1.0,  1.0, 
    -1.0, -1.0, 
    -1.0, -1.0, 
     1.0,  1.0, 
     1.0, -1.0
]));
var texcoord = app.createVertexBuffer(PicoGL.FLOAT, 2, new Float32Array([
    0.0,  0.0,
    1.0,  0.0,
    0.0,  1.0,
    0.0,  1.0,
    1.0,  0.0,
    1.0,  1.0
]));

var vertexArray = app.createVertexArray();
vertexArray.vertexAttributeBuffer(0, quadPositions);
vertexArray.vertexAttributeBuffer(1, texcoord);



// -------------------------------------------------------
// 3D Textures:
//
const DIMENSIONS = 2**6;

const initialGridState_3d = new Uint8Array(DIMENSIONS * DIMENSIONS * DIMENSIONS * 2);

const radius = 5;
const radius_2 = radius**2;
let center = [DIMENSIONS/2, DIMENSIONS/2, DIMENSIONS/2];

let textureIndex = 0;
for (let i = 0; i < DIMENSIONS; ++i) {
    for (let j = 0; j < DIMENSIONS; ++j) {
        for (let k = 0; k < DIMENSIONS; ++k) {
            let val = 255;
            if ((i-center[0])**2 + (j-center[1])**2 + (k-center[2])**2 <= radius_2) {
                initialGridState_3d[textureIndex*2] = 0;
                initialGridState_3d[textureIndex*2 + 1] = val;
            } 
            else {
                initialGridState_3d[textureIndex*2] = val;
                initialGridState_3d[textureIndex*2 + 1] = 0;
            }
            textureIndex++;
        }
    }
}

var currGridState_tex_3d = app.createTexture3D(initialGridState_3d, DIMENSIONS, DIMENSIONS, DIMENSIONS, { 
    internalFormat: PicoGL.RG8,
    maxAnisotropy: PicoGL.WEBGL_INFO.MAX_TEXTURE_ANISOTROPY 
});
var currGridState_3d = app.createFramebuffer();
currGridState_3d.colorTarget(0, currGridState_tex_3d);

var nextGridState_tex_3d = app.createTexture3D(initialGridState_3d, DIMENSIONS, DIMENSIONS, DIMENSIONS, { 
    internalFormat: PicoGL.RG8,
    maxAnisotropy: PicoGL.WEBGL_INFO.MAX_TEXTURE_ANISOTROPY 
});
var nextGridState_3d = app.createFramebuffer();
nextGridState_3d.colorTarget(0, nextGridState_tex_3d);


// ---------------------------------------
// CREATE POINT CLOUD
//
const INCREMENT = 1 / DIMENSIONS;

let positionData = new Float32Array(DIMENSIONS * DIMENSIONS * DIMENSIONS * 3);

let positionIndex = 0;
let x = -0.5;
for (let i = 0; i < DIMENSIONS; ++i) {
    let y = -0.5;
    for (let j = 0; j < DIMENSIONS; ++j) {
        let z = -0.5;
        for (let k = 0; k < DIMENSIONS; ++k) {
            positionData[positionIndex++] = x
            positionData[positionIndex++] = y
            positionData[positionIndex++] = z
            z += INCREMENT;
        }
        y += INCREMENT;
    }
    x += INCREMENT;
}

let pointPositions = app.createVertexBuffer(PicoGL.FLOAT, 3, positionData)

let pointArray = app.createVertexArray()
.vertexAttributeBuffer(0, pointPositions);



// UI
//
var FK = [[0.055, 0.062], [0.0367, 0.0649], [0.0545, 0.062]];
var FK_options = ['Standart', 'Mitosis', 'Coral Growth'];

let settings = {
    feed: 0.008,
    kill: 0.2,
    D_a: 0.3,
    D_b: 0.112,
    L_1: -0.4703,
    L_2: 0.06912,
    L_3: 0.07556,
    L_4: 0.0704,
    FK_index: 0,
}

webglLessonsUI.setupUI(document.querySelector('#ui'), settings, [
    {type: 'slider', key: 'feed', name: 'Feed', min: 0.0,    max: 0.1, step: 0.001, slide: (event, ui) => {
        settings.feed = ui.value;
        console.log(`feed: ${settings.feed}`);
    }},
    {type: 'slider', key: 'kill', name: 'Kill', min: 0.0,    max: 0.3, step: 0.001, slide: (event, ui) => {
        settings.kill = ui.value;
        console.log(`kill: ${settings.kill}`);
    }},
    {type: 'slider', key: 'D_a',  name: 'Diffusion Rate A',   min: 0.0,    max: 1.0, step: 0.001, slide: (event, ui) => {
        settings.D_a = ui.value;
        console.log(`D_a: ${settings.D_a}`);
    }},
    {type: 'slider', key: 'D_b',  name: 'Diffusion Rate B',   min: 0.0,    max: 1.0, step: 0.01, slide: (event, ui) => {
        settings.D_b = ui.value;
        console.log(`D_b: ${settings.D_b}`);
    }},
    {type: 'slider', key: 'L_1',  name: 'Laplacian 1',        min: -1.0,   max: 1.0, step: 0.01, slide: (event, ui) => {
        settings.L_1 = ui.value;
        console.log(`L_1: ${settings.L_1}`);
    }},
    {type: 'slider', key: 'L_2',  name: 'Laplacian 2',        min: 0.0,    max: 0.1, step: 0.001, slide: (event, ui) => {
        settings.L_2 = ui.value;
        console.log(`L_2: ${settings.L_2}`);
    }},
    {type: 'slider', key: 'L_3',  name: 'Laplacian 3',        min: 0.0,    max: 0.1, step: 0.001, slide: (event, ui) => {
        settings.L_3 = ui.value;
        console.log(`L_3: ${settings.L_3}`);
    }},
    {type: 'slider', key: 'L_4',  name: 'Laplacian 4',        min: -0.1,    max: 0.1, step: 0.001, slide: (event, ui) => {
        settings.L_4 = ui.value;
        console.log(`L_4: ${settings.L_4}`);
    }},
    {type: 'option', key: 'FK_index', name: 'Patterns',   options: FK_options,    change: (event, ui) => {
        settings.feed = FK[settings.FK_index][0];
        settings.kill = FK[settings.FK_index][1];
    }}
]);


var run = 1 ; 

var updateUniforms = app.createUniformBuffer([
    PicoGL.FLOAT,
    PicoGL.FLOAT,
    PicoGL.FLOAT,
    PicoGL.FLOAT,
    PicoGL.FLOAT,
    PicoGL.FLOAT,
    PicoGL.FLOAT,
    PicoGL.FLOAT,
    PicoGL.INT
]);

function updateBlock() {
    updateUniforms.set(0, settings.feed);
    updateUniforms.set(1, settings.kill);
    updateUniforms.set(2, settings.D_a);
    updateUniforms.set(3, settings.D_b);
    updateUniforms.set(4, settings.L_1);
    updateUniforms.set(5, settings.L_2);
    updateUniforms.set(6, settings.L_3);
    updateUniforms.set(7, settings.L_4);
    updateUniforms.set(8, run);
    updateUniforms.update();
}
updateBlock();



// SET UP UNIFORM BUFFER
//
let tex3DViewMatrix = mat4.create();
let tex3DEyePosition = vec3.fromValues(0.5, 1.0, 2.0);
mat4.lookAt(tex3DViewMatrix, tex3DEyePosition, vec3.fromValues(0, 0, 0), vec3.fromValues(0, 1, 0));

let viewMatrix = mat4.create();
// let eyePosition = vec3.fromValues(1.3, 0.9, 1);
let eyePosition = vec3.fromValues(1.3, 0.9, 0.0);
mat4.lookAt(viewMatrix, eyePosition, vec3.fromValues(0, 0, 0), vec3.fromValues(0, 1, 0));

let tex3DProjMatrix = mat4.create();
mat4.perspective(tex3DProjMatrix, Math.PI / 2, 1, 0.1, 10.0);

let projMatrix = mat4.create();
mat4.perspective(projMatrix, Math.PI / 2, canvas.width / canvas.height, 0.1, 10.0);

let tex3DViewProjMatrix = mat4.create();
mat4.multiply(tex3DViewProjMatrix, tex3DProjMatrix, tex3DViewMatrix);

let mvpMatrix = mat4.create();
mat4.multiply(mvpMatrix, projMatrix, viewMatrix);

let rot = mat4.create();
mat4.rotateX(rot, mvpMatrix, 0);
// mat4.rotateX(rot, mvpMatrix, -Math.PI / 2);

let rot_cte = 100;



// Creating program
app.createPrograms([updateVert, updateFrag], [pointsVertex, pointsFragment]).then(([tex3DProgram, pointsProgram]) => {

    // Update draw call to reaction diffusion
    let drawCall_update = app.createDrawCall(tex3DProgram, vertexArray)
    .texture("currState", currGridState_3d.colorAttachments[0]) // 3D texture
    .uniform('u_size', DIMENSIONS)
    .uniformBlock("UpdateUniforms", updateUniforms);

    // Draw call to the point cloud
    let drawCall = app.createDrawCall(pointsProgram, pointArray)
    .primitive(PicoGL.POINTS)
    .texture("tex", nextGridState_3d.colorAttachments[0]) // 3D texture
    .uniform('u_size', DIMENSIONS)
    .uniform("uMVP", rot);


    let i = 0;
    function drawMain() {
        
        updateBlock();

        app.drawFramebuffer(nextGridState_3d)
        .viewport(0, 0, DIMENSIONS, DIMENSIONS)
        .enable(PicoGL.DEPTH_TEST);

        for (let i = 1; i < DIMENSIONS-1; ++i) {
            nextGridState_3d.colorTarget(0, nextGridState_tex_3d, i);
            drawCall_update.uniform('layer', i);
            drawCall_update.draw();
        }
        app.readFramebuffer(nextGridState_3d)
        .drawFramebuffer(currGridState_3d)
        .blitFramebuffer(PicoGL.COLOR_BUFFER_BIT);

        // Render point cloud on canvas
        app.defaultDrawFramebuffer()
        .defaultViewport() // Set the viewport to the full canvas.;
        .enable(PicoGL.BLEND)

        if (i%2 == 0) {
            app.clear();
            drawCall.draw();
        }

        i++;


        // Key movements
        if (left == 1) mat4.rotateY(rot, rot, -Math.PI / rot_cte);
        if (right == 1) mat4.rotateY(rot, rot, Math.PI / rot_cte);
        if (down == 1) mat4.rotateX(rot, rot, Math.PI / rot_cte);
        if (up == 1) mat4.rotateX(rot, rot, -Math.PI / rot_cte);

        requestAnimationFrame(drawMain);
    }
    requestAnimationFrame(drawMain);

});





// -------------------------------------------------------------------------------------------------------------------------------------------------------------------
//
// CANVAS EVENTS:

let cte_obj = 7;

let obj_Rot = {
    x: 0,
    y: 0,
    z: 0
}
let left = 0;
let right = 0;
let up = 0;
let down = 0;
// let run = 0;

document.addEventListener('keydown', (event) => {
    switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
            up = 1;
            obj_Rot.x += cte_obj;
            break;

        case 'ArrowDown':
        case 'KeyS':
            down = 1;
            obj_Rot.x -= cte_obj;
            break;

        case 'ArrowRight':
        case 'KeyD':
            right = 1;
            obj_Rot.y -= cte_obj;
            break;

        case 'ArrowLeft':
        case 'KeyA':
            left = 1;
            obj_Rot.y += cte_obj;
            break;

        case 'Space':
            if (run == 1) run = 0;
            else run = 1;
            break;
    }
})

document.addEventListener('keyup', (event) => {
    switch (event.code) {
        case 'ArrowLeft':
        case 'KeyA':
            left = 0;
            break;

        case 'ArrowRight':
        case 'KeyD':
            right = 0;
            break;

        case 'ArrowUp':
        case 'KeyW':
            up = 0;
            obj_Rot.x += cte_obj;
            break;

        case 'ArrowDown':
        case 'KeyS':
            down = 0;
            obj_Rot.x -= cte_obj;
            break;
    }
})
