/**
 * Entry point.
 * @main Index
 */

import tendrilsDemo from './demo.main';

const readyStates = ['loading', 'interactive', 'complete'];

const triggerTimes = {
  spawnForm: [2e2, 3e2],
  spawnFlow: [2e2, 3e2],
  spawnFastest: [2e2, 3e2],
  def: [2e2]
};

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
      // static_image: './images/ringed-dot/w-b.png',
      use_media: false,
      use_mic: false,
      edit: false,
      keyboard: false,
      preset
    });

    canvas.classList.add('epok-dark');

    tendrils.track.loop = true;

    const rootClass = document.documentElement.classList;

    function updateRootAudio(on = !tendrils.track.paused) {
      rootClass.toggle('tendrils-audio-on', on);
      rootClass.toggle('tendrils-audio-off', !on);
    }

    function updateRootVideo(on = tendrils.appSettings.useMedia) {
      rootClass.toggle('tendrils-video-on', on);
      rootClass.toggle('tendrils-video-off', !on);
    }

    updateRootAudio();
    updateRootVideo();

    /** @see [Intersection-based infinite scroll example](https://googlechrome.github.io/samples/intersectionobserver/) */
    const intersector = new IntersectionObserver((all) => {
        const to = all.reduce((e0, e1) => {
            const { isIntersecting, intersectionRatio: r1, time, target } = e1;

            if(!isIntersecting) { return e0; }

            const { tendrilsTrigger, tendrilsPreset } = target.dataset;
            const f = tendrilsTrigger && tendrils.controls[tendrilsTrigger];

            f && console.log(tendrilsTrigger,
              (triggerTimes[tendrilsTrigger] || triggerTimes.def)
                .forEach((t) => setTimeout(f, t)));

            if(!tendrilsPreset) { return e0; }
            else if(!e0) { return e1; }

            const { intersectionRatio: r0, time: t0 } = e0;

            return (((r1 > r0) || ((r1 === r0) && (time > t0)))? e1 : e0);
          },
          null);

        if(!to) { return; }

        const p = to.target.dataset.tendrilsPreset;
        const f = p && (preset !== p) && tendrils.presets[preset = p];

        f && f();
      },
      { threshold: 0, root: null, rootMargin: '-49% 0%' });

    document.querySelectorAll('[data-tendrils-preset], [data-tendrils-trigger]')
      .forEach((e) => intersector.observe(e));

    document.querySelectorAll('.tendrils-audio').forEach(($e) =>
      $e.addEventListener('click', () => {
        tendrils.toggleTrack();
        updateRootAudio();
      }));

    document.querySelectorAll('.tendrils-video').forEach(($e) =>
      $e.addEventListener('click', () => {
        tendrils.toggleMedia();
        updateRootVideo();
      }));

    document.querySelectorAll('.activate-cam').forEach(($e) =>
      $e.addEventListener('click', () => {
        if(!tendrils.appSettings.useMedia) {
          tendrils.getMedia();
          updateRootVideo();
        }
      }));

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
