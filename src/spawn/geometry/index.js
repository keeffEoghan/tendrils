/**
 * Pretty quick thing to spawn particles from triangulated geometry (triangles,
 * for simple Platonic forms).
 *
 * @todo Clean up
 */

import geometry from 'gl-geometry';
import shader from 'gl-shader';
import { vec2 } from 'gl-matrix';

import * as spawnPixels from '../pixels';

import frag from '../pixels/bright-sample.frag';
// @todo Would like to direct with color, but doesn't seem to work with white...
// import frag from '../pixels/color-sample.frag';

import geometryVert from '../../geom/vert/index.vert';
import geometryFrag from '../../geom/frag/index.frag';

const { random, sin, cos, PI: pi, TAU: tau = pi*2 } = Math;

export const defaults = () => ({
  shader: [spawnPixels.defaults().shader[0], frag],
  drawShader: [geometryVert, geometryFrag],
  color: [1, 1, 1, 1],
  positions: Array(2*3*1).fill(0),
  shuffles: {
    size: 2, count: 3,
    radii: [0.25, 1.3], arcs: [1e-2, 3e-2],
    obtuse: { rate: 0.5, pad: 0.25 }
  }
});

export class GeometrySpawner extends spawnPixels.PixelSpawner {
  constructor(gl, options) {
    const to = defaults();
    const shuffles = Object.assign(to.shuffles, options.shuffles);

    Object.assign(to, options).shuffles = shuffles;
    super(gl, to);

    this.geometry = geometry(gl);

    this.drawShader = ((Array.isArray(to.drawShader))?
        shader(this.gl, ...to.drawShader)
      : to.drawShader);

    this.color = to.color;
    this.positions = to.positions;
    this.shuffles = shuffles;
  }

  shuffle() {
    const { shuffles, positions, geometry } = this;
    const { radii, arcs, obtuse, size, count } = shuffles;
    const [radiusMin, radiusMax] = radii;
    const [arcOffset, arcOver] = arcs;
    const { rate: obtuseRate, pad: obtusePad } = obtuse;
    const step = size*count;

    const radius = () => radiusMin+(random()*radiusMax);

    // Triangles, one vertex always in the center
    for(let t = positions.length-1; t >= 0; t -= step) {
      const angle = tau*random();

      const arc = tau*
          // Minimum arc offset
          (arcOffset+
            // Range of size
            (random()*arcOver)+
            // Acute or obtuse?
            ((random() < obtuseRate)*obtusePad));

      let rad = radius();

      positions[t-3] = cos(angle-arc)*rad;
      positions[t-2] = sin(angle-arc)*rad;

      rad = radius();
      positions[t-1] = cos(angle+arc)*rad;
      positions[t-0] = sin(angle+arc)*rad;

      // Skipping the center vertex, stays at [0, 0]
    }

    geometry.attr('position', positions, { size });

    return this;
  }

  spawn(tendrils, ...rest) {
    vec2.scale(this.buffer.shape, tendrils.viewRes, 0.2);
    // this.buffer.shape = tendrils.viewRes;

    this.buffer.bind();
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    this.drawShader.bind();

    this.drawShader.uniforms.color = this.color;
    this.drawShader.uniforms.viewSize = tendrils.viewSize;

    this.geometry.bind(this.drawShader);
    this.geometry.draw();
    this.geometry.unbind();

    return super.spawn(tendrils, ...rest);
  }
}

export default GeometrySpawner;
