/**
 * Entry point.
 * @main Index
 */

import tendrilsDemo from './demo.main';

const readyStates = ['loading', 'interactive', 'complete'];

// Load in stages.
let readyCallbacks = {
  loading: () => document.addEventListener('readystatechange', updateState),
  interactive() {
    const canvas = document.querySelector('canvas');
    let preset = 'S:Intro';
    // let preset = 'S:Awe';
    // let preset = 'S:Wonder';
    // let preset = 'S:Euphoria';
    // let preset = 'S:Inspiration';
    // let preset = 'S:Transcendence';
    // let preset = 'S:Basking';
    // let preset = 'S:Subscribe';

    const tendrils = tendrilsDemo(canvas, {
      // track: './audio/sub/clip.gitignore.mp3',
      // static_image: './images/sub/image.png',
      // use_media: false,
      edit: false,
      keyboard: false,
      preset
    });

    canvas.classList.add('epok-dark');

    tendrils.track.loop = true;

    /** @see [Intersection-based infinite scroll example](https://googlechrome.github.io/samples/intersectionobserver/) */
    const intersector = new IntersectionObserver((all) => {
        const to = all.reduce((to, at) => {
            const { isIntersecting: i1, time: t1 } = at;

            return ((i1 && (!to || (t1 > to.time)))? at : to);
          },
          null);

        const p = to && to.target.dataset.tendrilsPreset;
        const f = p && (preset !== (preset = p)) && tendrils.presets[p];

        f && f();
      },
      { threshold: 1 });

    document.querySelectorAll('[data-tendrils-preset]')
      .forEach((e) => intersector.observe(e));

    document.removeEventListener('readystatechange', updateState);
  }
};

let last = 0;

function updateState() {
  for(let s = readyStates.indexOf(document.readyState); last <= s; ++last) {
    let callback = readyCallbacks[readyStates[last]];

    if(callback) {
      try { callback(); }
      catch(e) { console.error(e); }
    }
  }
}

updateState();
