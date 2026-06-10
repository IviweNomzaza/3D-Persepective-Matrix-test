// ─── VERTEX SHADER ───────────────────────────────────────────────────────────
const vertexShaderSrc = `
  attribute vec4 a_position;
  attribute vec4 a_color;
  uniform mat4 u_matrix;
  varying vec4 v_color;

  void main() {
    gl_Position = u_matrix * a_position;
    v_color = a_color;
  }
`;

// ─── FRAGMENT SHADER ─────────────────────────────────────────────────────────
const fragmentShaderSrc = `
  precision mediump float;
  varying vec4 v_color;

  void main() {
    gl_FragColor = v_color;
  }
`;

// ─── GET CANVAS & CONTEXT ────────────────────────────────────────────────────
const canvas = document.getElementById("glCanvas");
const gl = canvas.getContext("webgl");

if (!gl) {
  alert("WebGL not supported in this browser.");
}

// ─── COMPILE A SHADER ────────────────────────────────────────────────────────
function compileShader(type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader error:", gl.getShaderInfoLog(shader));
  }
  return shader;
}

// ─── CREATE & LINK PROGRAM ───────────────────────────────────────────────────
const vertShader = compileShader(gl.VERTEX_SHADER, vertexShaderSrc);
const fragShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSrc);

const program = gl.createProgram();
gl.attachShader(program, vertShader);
gl.attachShader(program, fragShader);
gl.linkProgram(program);
gl.useProgram(program);

// ─── BUILD OCTAGON PRISM GEOMETRY ────────────────────────────────────────────
// An octagon has 8 sides. We build a prism with a top face, bottom face,
// and 8 rectangular side faces.

const NUM_SIDES = 8;
const RADIUS = 0.5;
const HALF_HEIGHT = 0.5;

// Compute the 8 corner points around the circle for top and bottom
function octPoints(y) {
  const pts = [];
  for (let i = 0; i < NUM_SIDES; i++) {
    const angle = (i / NUM_SIDES) * Math.PI * 2;
    pts.push([Math.cos(angle) * RADIUS, y, Math.sin(angle) * RADIUS]);
  }
  return pts;
}

const top = octPoints(HALF_HEIGHT);
const bot = octPoints(-HALF_HEIGHT);

// Colors for each face type
const topColor    = [0.4, 0.8, 1.0, 1.0];   // light blue   — top face
const botColor    = [0.2, 0.5, 0.8, 1.0];   // darker blue  — bottom face
const sideColors  = [                         // 8 side faces alternate two shades
  [0.9, 0.4, 0.3, 1.0],
  [0.8, 0.3, 0.5, 1.0],
];

const positions = [];
const colors    = [];

// Helper — push a triangle (3 verts) into the arrays
function pushTri(v0, v1, v2, col) {
  positions.push(...v0, ...v1, ...v2);
  colors.push(...col, ...col, ...col);
}

// Top face — fan from centre (0, HALF_HEIGHT, 0)
const topCentre = [0, HALF_HEIGHT, 0];
for (let i = 0; i < NUM_SIDES; i++) {
  const next = (i + 1) % NUM_SIDES;
  pushTri(topCentre, top[i], top[next], topColor);
}

// Bottom face — fan from centre (0, -HALF_HEIGHT, 0)
const botCentre = [0, -HALF_HEIGHT, 0];
for (let i = 0; i < NUM_SIDES; i++) {
  const next = (i + 1) % NUM_SIDES;
  pushTri(botCentre, bot[next], bot[i], botColor);  // reversed winding for correct face direction
}

// Side faces — each side is a quad made of 2 triangles
for (let i = 0; i < NUM_SIDES; i++) {
  const next = (i + 1) % NUM_SIDES;
  const col = sideColors[i % 2];

  // quad corners: top[i], top[next], bot[next], bot[i]
  pushTri(top[i],    top[next], bot[next], col);
  pushTri(top[i],    bot[next], bot[i],    col);
}

// ─── UPLOAD GEOMETRY TO GPU ──────────────────────────────────────────────────
// Position buffer
const posBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

const aPos = gl.getAttribLocation(program, "a_position");
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

// Color buffer
const colBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);

const aCol = gl.getAttribLocation(program, "a_color");
gl.enableVertexAttribArray(aCol);
gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, 0, 0);

// ─── MATRIX HELPERS ──────────────────────────────────────────────────────────
// All matrices are flat arrays of 16 numbers, column-major (WebGL style).

function identity() {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      for (let k = 0; k < 4; k++) {
        out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
      }
    }
  }
  return out;
}

// Rotation around Y axis
function rotateY(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
     c,  0, -s, 0,
     0,  1,  0, 0,
     s,  0,  c, 0,
     0,  0,  0, 1
  ];
}

// Rotation around X axis (slight tilt so we can see the top face)
function rotateX(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    1,  0,  0, 0,
    0,  c,  s, 0,
    0, -s,  c, 0,
    0,  0,  0, 1
  ];
}

// Simple perspective projection
function perspective(fovRad, aspect, near, far) {
  const f = 1.0 / Math.tan(fovRad / 2);
  const rangeInv = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * rangeInv, -1,
    0, 0, near * far * rangeInv * 2, 0
  ];
}

// Translation
function translate(tx, ty, tz) {
  return [
    1,  0,  0,  0,
    0,  1,  0,  0,
    0,  0,  1,  0,
    tx, ty, tz, 1
  ];
}

// ─── GET UNIFORM LOCATION ────────────────────────────────────────────────────
const uMatrix = gl.getUniformLocation(program, "u_matrix");

// ─── ENABLE DEPTH TEST ───────────────────────────────────────────────────────
gl.enable(gl.DEPTH_TEST);

// ─── DRAW LOOP ───────────────────────────────────────────────────────────────
let angle = 0;

function draw() {
  angle += 0.01;  // rotate a little each frame

  gl.clearColor(0.1, 0.1, 0.18, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Build the model-view-projection matrix
  // Order: perspective * view(translate back) * rotateX(tilt) * rotateY(spin)
  const proj  = perspective(Math.PI / 4, canvas.width / canvas.height, 0.1, 100);
  const view  = translate(0, 0, -2.5);          // move camera back
  const tiltX = rotateX(0.45);                  // slight tilt to show top face
  const spinY = rotateY(angle);

  let matrix = identity();
  matrix = multiply(spinY, matrix);
  matrix = multiply(tiltX, matrix);
  matrix = multiply(view,  matrix);
  matrix = multiply(proj,  matrix);

  gl.uniformMatrix4fv(uMatrix, false, matrix);

  const vertexCount = positions.length / 3;
  gl.drawArrays(gl.TRIANGLES, 0, vertexCount);

  requestAnimationFrame(draw);
}

draw();
