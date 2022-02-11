const canvas = document.getElementById("webgl-canvas");
const gl = canvas.getContext("webgl2");
if (!gl) console.log("Not ennable to run WebGL2 with this browser");

window.onresize = function() {
    app.resize(window.innerWidth, window.innerHeight);
}

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const app = PicoGL.createApp(canvas)
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

uniform settingsUniforms {
    float u_F;
    float u_K;
    float D_a;
    float D_b;
};

uniform sampler3D currState;
uniform float dim;
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
                    laplacian -= texture(currState, (position + vec3(coord[i], coord[j], coord[k])) / dim).xy;
                else 
                    laplacian += L * texture(currState, (position + vec3(coord[i], coord[j], coord[k])) / dim).xy;
            }
        }
    }

    vec3 color = texture(currState, position / dim).xyz;

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

uniform transUniforms {
    float volume_scale;
    mat4 transform;
    mat4 projMatrix;
    vec3 eyePosition;
};

out vec3 vray_dir;
flat out vec3 transformed_eye;

void main() {
    vec3 volume_translation = vec3(0.5) - vec3(volume_scale) * 0.5;

    gl_Position = projMatrix * transform * vec4(pos * vec3(volume_scale) + volume_translation, 1);

    transformed_eye = (eyePosition - volume_translation) / volume_scale;
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
        }
        
        color.a += val.y;

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
const quadPositions = app.createVertexBuffer(PicoGL.FLOAT, 2, new Float32Array([
    -1.0,  1.0, 
     1.0,  1.0, 
    -1.0, -1.0, 
    -1.0, -1.0, 
     1.0,  1.0, 
     1.0, -1.0
]));
const vertexArray = app.createVertexArray();
vertexArray.vertexAttributeBuffer(0, quadPositions);

const cubeStrip = app.createVertexBuffer(PicoGL.FLOAT, 3, new Float32Array([
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
const cubeArray = app.createVertexArray();
cubeArray.vertexAttributeBuffer(0, cubeStrip);


// ---------------------------------------------------------------------------------------------------------------------------
// 3D Textures:
//
const DIMENSIONS = 2**6;

let initialGridState_3d = new Uint8Array(DIMENSIONS * DIMENSIONS * DIMENSIONS * 2);

// Sphere initially  centered on the grid
const radius = 5;
const radius_2 = radius**2;
const center = [DIMENSIONS/2, DIMENSIONS/2, DIMENSIONS/2];

let textureIndex = 0;
for (let i = 0; i < DIMENSIONS; ++i) {
    for (let j = 0; j < DIMENSIONS; ++j) {
        for (let k = 0; k < DIMENSIONS; ++k) {
            if ((i-center[0])**2 + (j-center[1])**2 + (k-center[2])**2 <= radius_2) {
                initialGridState_3d[textureIndex*2] = 0;
                initialGridState_3d[textureIndex*2 + 1] = 255;
            } 
            else {
                initialGridState_3d[textureIndex*2] = 255;
                initialGridState_3d[textureIndex*2 + 1] = 0;
            }
            textureIndex++;
        }
    }
}

// Function that generates a 3D texture and the framebuffer that contains it using initialGridState_3d
function createTex() {
    let GridState_tex_3d  = app.createTexture3D(initialGridState_3d, DIMENSIONS, DIMENSIONS, DIMENSIONS, { 
        internalFormat: PicoGL.RG8,
        maxAnisotropy: PicoGL.WEBGL_INFO.MAX_TEXTURE_ANISOTROPY,
        magFilter: PicoGL.LINEAR,
        minFilter: PicoGL.LINEAR_MIPMAP_LINEAR
    });
    let GridState_3d = app.createFramebuffer();
    GridState_3d.colorTarget(0, GridState_tex_3d);
    return [GridState_tex_3d, GridState_3d];
}

// Framebuffers and textures that we will use to generate the 3D Reaction Diffusion process
let [currGridState_tex_3d, currGridState_3d] = createTex();
let [nextGridState_tex_3d, nextGridState_3d] = createTex();

// Freamebuffer to reload 3D textures to the inital state
let reload = 0;
let [reloadGrid_tex_3d, reloadGrid] = createTex();


// ---------------------------------------------------------------------------------------------------------------------------
// Setting up camera matrices:
//

let eyePosition = vec3.fromValues(0.5, 0.5, 1.5);
let cam_center = vec3.fromValues(0.5, 0.5, 0.5);
let cam_up = vec3.fromValues(0.0, 1.0, 0.0);

let camera = new ArcballCamera(eyePosition, cam_center, cam_up, 0.5, [canvas.width, canvas.height]);

let projMatrix = mat4.create();
mat4.perspective(projMatrix, Math.PI / 2, canvas.width / canvas.height, 0.1, 100.0);


// ---------------------------------------------------------------------------------------------------------------------------
// Setting up uniform blocks:
//

// Passing all variables of the UI to a uniform block
let settingsUniforms = app.createUniformBuffer(new Array(5).fill(PicoGL.FLOAT));
function updateSettings() {
    settingsUniforms.set(0, settings.feed);
    settingsUniforms.set(1, settings.kill);
    settingsUniforms.set(2, settings.D_a);
    settingsUniforms.set(3, settings.D_b);
    settingsUniforms.set(4, settings.L);
    settingsUniforms.update();
}
updateSettings();


let volume_scale = 1; // Variable to zoom in and out
// Uniform block of all transformations and variables involved in rendering the environment
let transUniforms = app.createUniformBuffer([
    PicoGL.FLOAT,
    PicoGL.FLOAT_MAT4,
    PicoGL.FLOAT_MAT4,
    PicoGL.FLOAT_VEC3
]);
function updateTrans() {
    transUniforms.set(0, volume_scale);
    transUniforms.set(1, camera.camera);
    transUniforms.set(2, projMatrix);
    transUniforms.set(3, [camera.invCamera[12], camera.invCamera[13], camera.invCamera[14]]);
    transUniforms.update();
}
updateTrans();


// ---------------------------------------------------------------------------------------------------------------------------
// Creating program:
//

let run = 1; // Variable to pause animation

app.createPrograms([updateVert, updateFrag], [RC_vertex, RC_fragment]).then(([tex3DProgram, RC_program]) => {
    
    // Update draw call to 3D reaction diffusion
    let drawCall_update = app.createDrawCall(tex3DProgram, vertexArray)
    .texture("currState", currGridState_3d.colorAttachments[0]) // 3D texture
    .uniformBlock("settingsUniforms", settingsUniforms)
    .uniform('dim', DIMENSIONS)

    let RC_drawCall = app.createDrawCall(RC_program, cubeArray)
    .primitive(PicoGL.TRIANGLE_STRIP)
    .uniformBlock("transUniforms", transUniforms)
    .texture("volume", nextGridState_3d.colorAttachments[0]) // 3D texture
    .uniform('volume_dims', [parseFloat(DIMENSIONS), parseFloat(DIMENSIONS), parseFloat(DIMENSIONS)])

    function drawMain() {
        updateSettings();
        updateTrans();
        
        if (run == 1) {
            // Setting viewport to render on the texture
            app.drawFramebuffer(nextGridState_3d)
            .viewport(0, 0, DIMENSIONS, DIMENSIONS)

            // Updating each layer of the 3D image
            for (let i = 0; i < DIMENSIONS; ++i) {
                let layer = (1 + 2*i)/2;
                nextGridState_3d.colorTarget(0, nextGridState_tex_3d, i);
                drawCall_update.uniform('layer', layer);
                drawCall_update.draw();
            }

            // Exchanging data between framebuffers
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

        app.clear();
        RC_drawCall.draw();

        requestAnimationFrame(drawMain);
    }
    requestAnimationFrame(drawMain);

});


// ---------------------------------------------------------------------------------------------------------------------------
//
// CANVAS EVENTS:

// Register mouse
const controller = new Controller();
controller.mousemove = function(prev, cur, evt) {
    if (evt.buttons == 1) {
        camera.rotate(prev, cur);

    } else if (evt.buttons == 2) {
        camera.pan([cur[0] - prev[0], prev[1] - cur[1]]);
    }
};
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
