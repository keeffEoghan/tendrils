/**
 * Entry point.
 * @main Index
 */

import tendrilsDemo from './demo.main';

const { PI: pi } = Math;

const dev = location.hostname.search(/.webflow.io$/gi) < 0;

const stopEffect = (e) => e.preventDefault();
const stopBubble = (e) => e.stopPropagation();

function stopEvent(e) {
  stopEffect(e);
  stopBubble(e);
}

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
    const $canvas = document.querySelector('canvas');
    let preset = 'S:Intro';
    // let preset = 'S:Awe';
    // let preset = 'S:Wonder';
    // let preset = 'S:Euphoria';
    // let preset = 'S:Inspiration';
    // let preset = 'S:Transcendence';
    // let preset = 'S:Basking';
    // let preset = 'S:Subscribe';

    const tendrils = tendrilsDemo($canvas, {
      use_media: false, use_mic: false, edit: false, keyboard: false, preset
    });

    const { appSettings, track, video, controls, presets } = tendrils;
    const { toggleTrack, toggleMedia, getMedia, restartAudio } = tendrils;
    const { geometrySpawner, audioContext } = tendrils;
    let trackOK = false;

    $canvas.classList.add('epok-dark');
    document.body.appendChild(track);
    track.querySelector('source').type = 'audio/mpeg';
    track.loop = true;
    track.controls = true;
    track.volume = 0;

    const { radii, obtuse, arcs } = geometrySpawner.shuffles;

    radii[0] = 0.2;
    radii[1] = 0.4;
    arcs[0] = 0.1;
    arcs[1] = 0.03;
    obtuse.rate = 0;

    const rootClass = document.body.classList;

    function flipAudioPlay(on = !track.paused) {
      rootClass.toggle('tendrils-audio-on', on);
      rootClass.toggle('tendrils-audio-off', !on);
    }

    function flipVideoPlay(on = !video.paused) {
      rootClass.toggle('tendrils-video-on', on);
      rootClass.toggle('tendrils-video-off', !on);
    }

    function flipAudioShow(on = (trackOK && audioContext.state === 'running')) {
      rootClass.toggle('tendrils-audio-show', on);
      rootClass.toggle('tendrils-audio-hide', !on);
    }

    function flipVideoShow(on = rootClass.contains('tendrils-video-hide')) {
      rootClass.toggle('tendrils-video-show', on);
      rootClass.toggle('tendrils-video-hide', !on);
    }

    flipAudioPlay();
    flipVideoPlay();
    track.addEventListener('play', () => flipAudioPlay());
    track.addEventListener('pause', () => flipAudioPlay());
    video.addEventListener('play', () => flipVideoPlay());
    video.addEventListener('pause', () => flipVideoPlay());

    const checkTrack = () => Promise.resolve(toggleTrack(true))
      .then(() => {
        (trackOK = true) && (track.volume = 1) && flipAudioShow();
        removeEventListener('change', checkTrack);
        removeEventListener('click', checkTrack);
        removeEventListener('contextmenu', checkTrack);
        removeEventListener('dblclick', checkTrack);
        removeEventListener('mouseup', checkTrack);
        removeEventListener('pointerup', checkTrack);
        removeEventListener('reset', checkTrack);
        removeEventListener('submit', checkTrack);
        removeEventListener('touchend', checkTrack);
      })
      .catch((e) => {
        console.warn("Can't toggle audio track:", e);
        dev && alert("Can't toggle audio track: "+e);
      })
      .finally(() => setTimeout(() => toggleTrack(false)));

    addEventListener('change', checkTrack);
    addEventListener('click', checkTrack);
    addEventListener('contextmenu', checkTrack);
    addEventListener('dblclick', checkTrack);
    addEventListener('mouseup', checkTrack);
    addEventListener('pointerup', checkTrack);
    addEventListener('reset', checkTrack);
    addEventListener('submit', checkTrack);
    addEventListener('touchend', checkTrack);

    flipAudioShow();
    audioContext.addEventListener('statechange', () => flipAudioShow());

    /** @see [Intersection-based infinite scroll example](https://googlechrome.github.io/samples/intersectionobserver/) */
    const intersector = new IntersectionObserver((all) => {
        const to = all.reduce((e0, e1) => {
            const { isIntersecting, intersectionRatio: r1, time, target } = e1;

            if(!isIntersecting) { return e0; }

            const { tendrilsTrigger, tendrilsPreset } = target.dataset;
            const f = tendrilsTrigger && controls[tendrilsTrigger];

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
        const f = p && (preset !== p) && presets[preset = p];

        f && f();
      },
      { threshold: 0, root: null, rootMargin: '-49% 0%' });

    document.querySelectorAll('[data-tendrils-preset], [data-tendrils-trigger]')
      .forEach((e) => intersector.observe(e));

    const $audioFlips = document.querySelectorAll('.tendrils-audio');
    const $videoFlips = document.querySelectorAll('.tendrils-video');
    const $videoOns = document.querySelectorAll('.tendrils-video-on');

    $audioFlips.forEach(($e) => $e.addEventListener('click', (e) => {
      Promise.resolve(toggleTrack())
        .catch((e) => {
          console.warn("Can't toggle audio track:", e);
          dev && alert("Can't toggle audio track: "+e);
        });

      restartAudio();
      stopEvent(e);
    }));

    $videoFlips.forEach(($e) => $e.addEventListener('click', (e) => {
      Promise.resolve(toggleMedia())
        .catch((e) => {
          console.warn("Can't toggle video camera:", e);
          dev && alert("Can't toggle video camera: "+e);
        });

      restartAudio();
      stopEvent(e);
    }));

    flipVideoShow(false);

    $videoOns.forEach(($e) => $e.addEventListener('click', () =>
      Promise.resolve(getMedia())
        .then(() => flipVideoShow(true))
        .catch((e) => {
          console.warn("Can't start video camera:", e);
          dev && alert("Can't start video camera: "+e);
        })));

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
