
var canvas = document.getElementById("webgl-canvas");
var gl = canvas.getContext("webgl2");
if (!gl) console.log("Not ennable to run WebGL2 with this browser");

window.onresize = function() {
    app.resize(window.innerWidth, window.innerHeight);
}

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

var app = PicoGL.createApp(canvas)
.clearColor(0.0, 0., 0.15, 1.0)
.enable(PicoGL.BLEND)
.enable(PicoGL.DEPTH_TEST)
.enable(PicoGL.CULL_FACE)
.blendFunc(PicoGL.SRC_ALPHA, PicoGL.ONE_MINUS_SRC_ALPHA)
.clear();

gl.cullFace(PicoGL.FRONT)


// Shaders that will update the frame of 3D reaction diffusion
//
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

uniform UpdateUniforms {
    float u_F;
    float u_K;
    float D_a;
    float D_b;
};

uniform sampler3D currState;
uniform float u_size;
uniform float layer;

float D_t = 1.;
float L = 1./26.;

out vec4 fragColor;
void main() {
    vec3 position = vec3(gl_FragCoord.xy, layer);

    vec2 laplacian;
    
    float coord[3] = float[3](-1.0, 0.0, 1.0);
    for(int i=0; i<3; i++) {
        for(int j=0; j<3; j++) {
            for(int k=0; k<3; k++) {
                if (vec3(i, j, k) == vec3(1.))
                    laplacian -= texture(currState, (position + vec3(coord[i], coord[j], coord[k])) / u_size).xy;
                else 
                    laplacian += L * texture(currState, (position + vec3(coord[i], coord[j], coord[k])) / u_size).xy;
            }
        }
    }

    vec3 color = texture(currState, position / u_size).xyz;

    float A = color.x + D_t * (D_a * laplacian.x - color.x * color.y * color.y + u_F * (1.0 - color.x));
    float B = color.y + D_t * (D_b * laplacian.y + color.x * color.y * color.y - (u_K + u_F) * color.y);
    fragColor = vec4(A, B, 0.0, 1.0);
}`


// Shaders to render all the 3D data using Ray Casting
//
const RC_vertex = `
#version 300 es
precision mediump float;

in vec3 pos;

uniform float volume_scale;
uniform mat4 projView;
uniform vec3 eyePosition_2;

out vec3 vray_dir;
flat out vec3 transformed_eye;

void main() {
    vec3 volume_translation = vec3(0.5) - vec3(volume_scale) * 0.5;

    gl_Position = projView * vec4(pos * vec3(volume_scale) + volume_translation, 1);

    transformed_eye = (eyePosition_2 - volume_translation) / volume_scale;
    vray_dir = pos - transformed_eye;
}`

const RC_fragment = `
#version 300 es
precision mediump float;
precision lowp sampler3D;

uniform sampler3D volume;
uniform vec3 volume_dims;

in vec3 vray_dir;
flat in vec3 transformed_eye;

vec2 intersect_box(vec3 orig, vec3 dir) {
	const vec3 box_min = vec3(0.);
	const vec3 box_max = vec3(1.);
	vec3 inv_dir = 1.0 / dir;
	vec3 tmin_tmp = (box_min - orig) * inv_dir;
	vec3 tmax_tmp = (box_max - orig) * inv_dir;
	vec3 tmin = min(tmin_tmp, tmax_tmp);
	vec3 tmax = max(tmin_tmp, tmax_tmp);
	float t0 = max(tmin.x, max(tmin.y, tmin.z));
	float t1 = min(tmax.x, min(tmax.y, tmax.z));
	return vec2(t0, t1);
}

float linear_to_srgb(float x) {
	if (x <= 0.0031308f) {
		return 12.92f * x;
	}
	return 1.055f * pow(x, 1.f / 2.4f) - 0.055f;
}

// Pseudo-random number gen from
// http://www.reedbeta.com/blog/quick-and-easy-gpu-random-numbers-in-d3d11/
// with some tweaks for the range of values
float wang_hash(int seed) {
	seed = (seed ^ 61) ^ (seed >> 16);
	seed *= 9;
	seed = seed ^ (seed >> 4);
	seed *= 0x27d4eb2d;
	seed = seed ^ (seed >> 15);
	return float(seed % 2147483647) / float(2147483647);
}

out vec4 color;
void main() {

    vec3 ray_dir = normalize(vray_dir);
	vec2 t_hit = intersect_box(transformed_eye, ray_dir);
	if (t_hit.x > t_hit.y) {
		discard;
	}

    t_hit.x = max(t_hit.x, 0.0);

    vec3 dt_vec = 1.0 / (vec3(volume_dims) * abs(ray_dir));
	float dt = min(dt_vec.x, min(dt_vec.y, dt_vec.z));

    float offset = wang_hash(int(gl_FragCoord.x + 640.0 * gl_FragCoord.y));
    vec3 p = transformed_eye + (t_hit.x + offset * dt) * ray_dir;

    float depth = 0.;
    for (float t = t_hit.x; t < t_hit.y; t += dt) {
        vec3 val = texture(volume, p).xyz;

        if (val.y > 0.3) {
            color.rgb += (1. - color.x) * val.y;
            color.a += (1. - color.y) * val.y;
        }
        
        color.w += val.y;

        if (color.w >= 0.95) {
            break;
        }

        p += ray_dir * dt;
    }
    color.xyz *= p;
    color.r = linear_to_srgb(color.r);
    color.g = linear_to_srgb(color.g);
    color.b = linear_to_srgb(color.b);
}`


// ---------------------------------------------------------------------------------------------------------------------------
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
var vertexArray = app.createVertexArray();
vertexArray.vertexAttributeBuffer(0, quadPositions);

var cubeStrip = app.createVertexBuffer(PicoGL.FLOAT, 3, new Float32Array([
    1, 1, 0,
	0, 1, 0,
	1, 1, 1,
	0, 1, 1,
	0, 0, 1,
	0, 1, 0,
	0, 0, 0,
	1, 1, 0,
	1, 0, 0,
	1, 1, 1,
	1, 0, 1,
	0, 0, 1,
	1, 0, 0,
	0, 0, 0
]));
var cubeArray = app.createVertexArray();
cubeArray.vertexAttributeBuffer(0, cubeStrip);


// ---------------------------------------------------------------------------------------------------------------------------
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

function createTex() {
    var GridState_tex_3d  = app.createTexture3D(initialGridState_3d, DIMENSIONS, DIMENSIONS, DIMENSIONS, { 
        internalFormat: PicoGL.RG8,
        maxAnisotropy: PicoGL.WEBGL_INFO.MAX_TEXTURE_ANISOTROPY,
        magFilter: PicoGL.LINEAR,
        minFilter: PicoGL.LINEAR_MIPMAP_LINEAR 
    });
    var GridState_3d = app.createFramebuffer();
    GridState_3d.colorTarget(0, GridState_tex_3d);
    return [GridState_tex_3d, GridState_3d];
}

var [currGridState_tex_3d, currGridState_3d] = createTex();
var [nextGridState_tex_3d, nextGridState_3d] = createTex();

// Freamebuffer to reload 3d texture to the inital state
var reload = 0;
var [reloadGrid_tex_3d, reloadGrid] = createTex();


// ---------------------------------------------------------------------------------------------------------------------------
// UI
//
let settings = {
    feed: 0.0233,
    kill: 0.07,
    D_a: 0.562,
    D_b: 0.111
}

webglLessonsUI.setupUI(document.querySelector('#ui'), settings, [
    {type: 'slider', key: 'feed', name: 'Feed', min: 0.0,    max: 0.1, step: 0.001, slide: (event, ui) => {
        settings.feed = ui.value;
        console.log(`feed: ${settings.feed}`);
    }},
    {type: 'slider', key: 'kill', name: 'Kill', min: 0.0,    max: 0.4, step: 0.001, slide: (event, ui) => {
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
    }}
]);

// Passing all variables of the UI to an uniform block
var updateUniforms = app.createUniformBuffer(new Array(5).fill(PicoGL.FLOAT));

function updateBlock() {
    updateUniforms.set(0, settings.feed);
    updateUniforms.set(1, settings.kill);
    updateUniforms.set(2, settings.D_a);
    updateUniforms.set(3, settings.D_b);
    updateUniforms.set(4, settings.L);
    updateUniforms.update();
}
updateBlock();


// ---------------------------------------------------------------------------------------------------------------------------
// SET UP CAMERA MATRICES
//

let eyePosition = vec3.fromValues(0.5, 0.5, 1.5);
let cam_center = vec3.fromValues(0.5, 0.5, 0.5);

let eyePosition_2 = vec3.fromValues(0., 0., 1.);
let cam_center_2 = vec3.fromValues(0., 0., 0.);

let cam_up = vec3.fromValues(0.0, 1.0, 0.0);

let camera = new ArcballCamera(eyePosition, cam_center, cam_up, 2, [canvas.width, canvas.height]);
let camera_2 = new ArcballCamera(eyePosition_2, cam_center_2, cam_up, 2, [canvas.width, canvas.height], 1);
camera.zoom(280);

let projView = mat4.create(); 
let projView_2 = mat4.create(); 


let viewMatrix = mat4.create();
mat4.lookAt(viewMatrix, eyePosition, cam_center, cam_up);

let projMatrix = mat4.create();
mat4.perspective(projMatrix, Math.PI / 2, canvas.width / canvas.height, 0.1, 100.0);

let mvpMatrix = mat4.create();
mat4.multiply(mvpMatrix, projMatrix, viewMatrix);


var run = 1;
let volume_scale = 1;


// ---------------------------------------------------------------------------------------------------------------------------
// Creating program
//
app.createPrograms([updateVert, updateFrag], [RC_vertex, RC_fragment]).then(([tex3DProgram, RC_program]) => {

    // Update draw call to 3D reaction diffusion
    let drawCall_update = app.createDrawCall(tex3DProgram, vertexArray)
    .texture("currState", currGridState_3d.colorAttachments[0]) // 3D texture
    .uniform('u_size', DIMENSIONS)
    .uniformBlock("UpdateUniforms", updateUniforms);

    let RC_drawCall = app.createDrawCall(RC_program, cubeArray)
    .primitive(PicoGL.TRIANGLE_STRIP)
    .uniform("volume_scale", volume_scale)
    .uniform('transform', camera.camera)
    .uniform('eyePosition_2', [camera_2.invCamera[12], camera_2.invCamera[13], camera_2.invCamera[14]])
    .texture("volume", nextGridState_3d.colorAttachments[0]) // 3D texture
    .uniform('volume_dims', [parseFloat(DIMENSIONS), parseFloat(DIMENSIONS), parseFloat(DIMENSIONS)])

    function drawMain() {
        updateBlock();
        
        if (run == 1) {
            app.drawFramebuffer(nextGridState_3d)
            .viewport(0, 0, DIMENSIONS, DIMENSIONS)

            // Updating each layer of the 3D image
            for (let i = 0; i < DIMENSIONS; ++i) {
                let layer = (1 + 2*i)/2;
                nextGridState_3d.colorTarget(0, nextGridState_tex_3d, i);
                drawCall_update.uniform('layer', layer);
                drawCall_update.draw();
            }

            // Changing data from each framebuffer
            app.readFramebuffer(nextGridState_3d)
            .drawFramebuffer(currGridState_3d)
            .blitFramebuffer(PicoGL.COLOR_BUFFER_BIT);
        }

        // Rendering on canvas
        app.defaultDrawFramebuffer()
        .defaultViewport() // Set the viewport to the full canvas
        .enable(PicoGL.BLEND)
        .enable(PicoGL.DEPTH_TEST);

        if (reload == 1) {
            app.readFramebuffer(reloadGrid)
            .drawFramebuffer(currGridState_3d)
            .blitFramebuffer(PicoGL.COLOR_BUFFER_BIT);
            reload = 0;
        }

        
        projView = mat4.mul(projView, mvpMatrix, camera.camera);
        projView_2 = mat4.mul(projView_2, mvpMatrix, camera_2.camera);

        app.clear();
        RC_drawCall.uniform("volume_scale", volume_scale)
        RC_drawCall.uniform('projView', projView)
        RC_drawCall.uniform('eyePosition_2', [camera_2.invCamera[12], camera_2.invCamera[13], camera_2.invCamera[14]])
        RC_drawCall.draw();

        requestAnimationFrame(drawMain);
    }
    requestAnimationFrame(drawMain);

});


// ---------------------------------------------------------------------------------------------------------------------------
//
// CANVAS EVENTS:

// Register mouse and touch listeners
var controller = new Controller();
controller.mousemove = function(prev, cur, evt) {
    if (evt.buttons == 1) {
        camera.rotate(prev, cur);
        camera_2.rotate(prev, cur);

    } else if (evt.buttons == 2) {
        camera.pan([cur[0] - prev[0], prev[1] - cur[1]]);
        camera_2.pan([cur[0] - prev[0], prev[1] - cur[1]]);
    }
};

controller.twoFingerDrag = function(drag) { camera.pan(drag); };

controller.registerForCanvas(canvas);

// Zoom event
document.addEventListener('mousewheel', (event) => {
    if (event.wheelDelta < 0) {
        volume_scale -= 0.1;
    }
    else {
        volume_scale += 0.1;
    }
})

// Key events to pause and reload
document.addEventListener('keydown', (event) => {
    switch (event.code) {
        case 'Space':
            if (run == 1) run = 0;
            else run = 1;
            break;

        case 'KeyR':
            if (reload == 1) reload = 0;
            else reload = 1;
            break;
    }
})
