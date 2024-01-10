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
      static_image: './images/ringed-dot/w-b.png',
      use_media: false,
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

            if(i1) {
              const t = at.target.dataset.tendrilsTrigger;
              const f = t && tendrils.controls[t];

              f && console.log(t, setTimeout(f, 300));
            }

            return ((i1 && (!to || (t1 > to.time)))? at : to);
          },
          null);

        if(!to) { return; }

        const p = to.target.dataset.tendrilsPreset;
        const f = p && (preset !== (preset = p)) && tendrils.presets[p];

        f && f();
      },
      { threshold: 1 });

    document.querySelectorAll('[data-tendrils-preset], [data-tendrils-trigger]')
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
