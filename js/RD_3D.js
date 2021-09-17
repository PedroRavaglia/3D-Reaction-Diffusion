
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
precision mediump float;

uniform sampler2D currState;
uniform vec2 u_size;

const float u_F = 0.055;
const float u_K = 0.01;
const float D_a = 1.0;
const float D_b = 0.5;
const float D_t = 1.0;

out vec4 fragColor;
void main() {
    vec2 position = gl_FragCoord.xy;
    vec3 color = texture(currState, position / u_size).xyz;

    vec2 laplacian = 
        - 1.0  * color.xy

        + 0.2  * texture(currState, (position + vec2(0.0, 1.0)) / u_size).xy
        + 0.2  * texture(currState, (position + vec2(1.0, 0.0)) / u_size).xy
        + 0.2  * texture(currState, (position + vec2(0.0, -1.0)) / u_size).xy
        + 0.2  * texture(currState, (position + vec2(-1.0, 0.0)) / u_size).xy

        + 0.05 * texture(currState, (position + vec2(-1.0, -1.0)) / u_size).xy
        + 0.05 * texture(currState, (position + vec2(-1.0,  1.0)) / u_size).xy
        + 0.05 * texture(currState, (position + vec2( 1.0, -1.0)) / u_size).xy
        + 0.05 * texture(currState, (position + vec2( 1.0,  1.0)) / u_size).xy
        ;

    float A = color.x + D_t * (D_a * laplacian.x - color.x * color.y * color.y + u_F * (1.0 - color.x));
    float B = color.y + D_t * (D_b * laplacian.y + color.x * color.y * color.y - (u_K + u_F) * color.y);

    fragColor = vec4(A, B, 0.0, 1.0);
}`



// Shader that will render the texture that will be used in the point cloud
const vert_to_points = `
#version 300 es

in vec2 position;
in vec2 uv;

out vec2 vUV;
void main () {
    gl_Position = vec4(position, 0, 1);
    vUV = uv;
}`

const frag_to_points = `
#version 300 es
precision mediump float;

in vec2 vUV;

uniform sampler2D nextGridState;

out vec4 fragColor;
void main() {

    // Draw to the point cloud
    float A = texture(nextGridState, vUV).x;
    float B = texture(nextGridState, vUV).y;
    fragColor = vec4(A-B, A-B, A-B, 1.0);

    // vec3 color = texture(nextGridState, vUV).xyz;
    // fragColor = vec4(color, 1.0);
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
    gl_Position = uMVP * position;

    vec4 color = texture(tex, vUV);
    if (color.x < 0.8) {
        gl_PointSize = 5.8;
    } else {
        gl_PointSize = 0.0;
    }
}`

const pointsFragment = `
#version 300 es
precision highp float;
precision lowp sampler3D;

in vec3 vUV;

uniform sampler3D tex;

out vec4 fragColor;
void main() {
    fragColor = texture(tex, vUV);
}`



// Geometry data:
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



// 2D Textures:
function dot(cx, cy, r = 80) {
    const r2 = r ** 2;
    for (let y = cy - r; y < cy + r; ++y) {
        for (let x = cx - r; x < cx + r; ++x) {
            if ((x - cx) ** 2 + (y - cy) ** 2 < r2) {
                const i = canvas.width * y + x << 2;
                initialGridState[i] = 0;
                initialGridState[i + 1] = 255;
            }
        }
    }
}

const initialGridState = new Uint8Array(canvas.width * canvas.height * 4);
for (let i = 0; i < canvas.width * canvas.height; ++i) {
    initialGridState[i * 4] = 255;
}
for (let i = 0; i < 10; ++i) {
    dot(canvas.width * Math.random(), canvas.height * Math.random());
}

var currGridState_tex = app.createTexture2D(initialGridState, canvas.width, canvas.height);
var currGridState = app.createFramebuffer();
currGridState.colorTarget(0, currGridState_tex);

var nextGridState_tex = app.createTexture2D(initialGridState, canvas.width, canvas.height);
var nextGridState = app.createFramebuffer();
nextGridState.colorTarget(0, nextGridState_tex);


// 3D Texture:
const DIMENSIONS = 2**5;

let colorTarget = app.createTexture3D(DIMENSIONS, DIMENSIONS, DIMENSIONS, {
    maxAnisotropy: PicoGL.WEBGL_INFO.MAX_TEXTURE_ANISOTROPY 
});

let framebuffer = app.createFramebuffer()
.colorTarget(0, colorTarget);


// CREATE POINT CLOUD
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



// SET UP UNIFORM BUFFER
let tex3DViewMatrix = mat4.create();
let tex3DEyePosition = vec3.fromValues(0.5, 1.0, 2.0);
mat4.lookAt(tex3DViewMatrix, tex3DEyePosition, vec3.fromValues(0, 0, 0), vec3.fromValues(0, 1, 0));

let viewMatrix = mat4.create();
let eyePosition = vec3.fromValues(1.3, 0.9, 1);
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

let rot_cte = 100;



// Creating program
app.createPrograms([updateVert, updateFrag], [vert_to_points, frag_to_points], [pointsVertex, pointsFragment]).then(([tex3DProgram, to_pointsProgram, pointsProgram]) => {

    // Update draw call to reaction diffusion
    let drawCall_update = app.createDrawCall(tex3DProgram, vertexArray)
    .texture("currState", currGridState.colorAttachments[0]) // 2D texture
    .uniform('u_size', [canvas.width, canvas.height]);

    // Render the reaction diffusion texture to the points cloud
    let to_pointsDrawCall = app.createDrawCall(to_pointsProgram, vertexArray)
    .texture("nextGridState", nextGridState.colorAttachments[0]) // 2D texture

    // Draw call to the point cloud
    let drawCall = app.createDrawCall(pointsProgram, pointArray)
    .primitive(PicoGL.POINTS)
    .texture("tex", colorTarget) // 3D texture
    .uniform("uMVP", rot);


    function drawMain() {
        // console.log(1);

        // Reaction diffusion
        app.drawFramebuffer(nextGridState);
        drawCall_update.draw();

        app.readFramebuffer(nextGridState)
        .drawFramebuffer(currGridState)
        .blitFramebuffer(PicoGL.COLOR_BUFFER_BIT); // Copy data from framebuffer attached to READ_FRAMEBUFFER to framebuffer attached to DRAW_FRAMEBUFFER.

        // Render to the 3D texture
        app.drawFramebuffer(framebuffer)
        .viewport(0, 0, DIMENSIONS, DIMENSIONS)
        .enable(PicoGL.DEPTH_TEST)

        for (let i = 0; i < DIMENSIONS; ++i) {

            framebuffer.colorTarget(0, colorTarget, i);
            
            app.clear();
            to_pointsDrawCall.draw();
        }   

        // Render point cloud on canvas
        app.defaultDrawFramebuffer()
        .defaultViewport() // Set the viewport to the full canvas.
        .enable(PicoGL.BLEND)

        app.clear();
        drawCall.draw();


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
let run = 0;

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