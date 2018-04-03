/**
 * A demo of the tendrils visuals - originally an interactive music video for
 * Max Cooper's "Trust".
 *
 * Disclaimer:
 * Several things done here (animation engine, audio analysis and response,
 * mouse/touch interaction, and some of the non-core shader stuff) are basically
 * learning exercises and experiments for me:
 *     - There are better approaches and libraries out there.
 *     - These were an interesting way for me to learn what might go into building
 *       these things.
 *     - There are some not very well researched, or combinations of
 *       odd/different approaches in here.
 * ...so, wouldn't take any of them as good ideas straight away.
 */

/* global Map */

import 'pepjs';
import glContext from 'gl-context';
import vkey from 'vkey';
import getUserMedia from 'getusermedia';
import analyser from 'web-audio-analyser';
import soundCloud from 'soundcloud-badge';
import offset from 'mouse-event-offset';
import throttle from 'lodash/throttle';
import mapRange from 'range-fit';
import clamp from 'clamp';
import { mat3, vec2 } from 'gl-matrix';
import querystring from 'querystring';
import toSource from 'to-source';
import shader from 'gl-shader';
import prefixes from 'prefixes';
import xhr from 'xhr';

// import dat from 'dat-gui';
import dat from '../libs/dat.gui/build/dat.gui';

import { rootPath } from './utils/';
import redirect from './utils/protocol-redirect';

import Timer from './timer';

import { Tendrils, defaults, glSettings } from './';

import * as spawnPixels from './spawn/pixels';
import pixelsFrag from './spawn/pixels/index.frag';
import bestSampleFrag from './spawn/pixels/best-sample.frag';
import flowSampleFrag from './spawn/pixels/flow-sample.frag';
import dataSampleFrag from './spawn/pixels/data-sample.frag';

import spawnReset from './spawn/ball';
import GeometrySpawner from './spawn/geometry';

import AudioTrigger from './audio';
import AudioTexture from './audio/data-texture';
import { peak, meanWeight } from './analyse';

import FlowLines from './flow-line/multi';

import Player from './animate';

import Screen from './screen';
import Blend from './screen/blend';
import screenVert from './screen/index.vert';
import blurFrag from './screen/blur.frag';
import OpticalFlow from './optical-flow';

import { curry } from './fp/partial';
import reduce from './fp/reduce';
import map from './fp/map';
import each from './fp/each';

toSource.defaultFnFormatter = (depth, f) => f.name;

export default (canvas, options) => {
    if(redirect()) {
        return;
    }

    const settings = Object.assign(querystring.parse(location.search.slice(1)),
        options);

    const defaultSettings = defaults();
    const defaultState = defaultSettings.state;


    // Main init

    const gl = glContext(canvas, glSettings, render);

    const timer = {
        app: defaultSettings.timer,
        track: new Timer(0)
    };


    // Tendrils init

    const tendrils = new Tendrils(gl, {
        timer: timer.app,
        numBuffers: 1
    });

    /**
     * Stateful but convenient way to set which buffer we spawn into.
     * Set the properties to the targets used by the corresponding spawn
     * functions: to a buffer (e.g: `tedrils.targets`) to spawn into it; or
     * `undefined` to spawn into the default (the next particle step buffer).
     *
     * @type {Object.<(FBO|undefined)>}
     */
    const spawnTargets = {};

    const resetSpawner = spawnReset(gl);

    resetSpawner.shader.bind();


    // Some convenient shorthands

    const respawn = (buffer = spawnTargets.respawn) =>
        resetSpawner.spawn(tendrils, buffer);

    const reset = () => tendrils.reset();

    const restart = () => {
        tendrils.clear();
        respawn();
        respawn(tendrils.targets);
    };

    const clear = () => tendrils.clear();
    const clearView = () => tendrils.clearView();
    const clearFlow = () => tendrils.clearFlow();

    const state = tendrils.state;

    const appSettings = {
        trackURL: (((''+settings.track).match(/(false|undefined)/gi))?
                ''
            :   decodeURIComponent(settings.track)),

        animate: (''+settings.animate !== 'false'),
        useMedia: (''+settings.use_media !== 'false'),
        pointerFlow: (''+settings.pointer_flow !== 'false'),
        staticImage: ((settings.static_image)?
                decodeURIComponent(settings.static_image)
            :   rootPath+'build/images/epok/eye.png')
    };

    if(''+settings.cursor === 'false') {
        canvas.classList.add('epok-no-cursor');
    }


    // Audio init

    const audioDefaults = {
        audible: (''+settings.mute !== 'true'),

        track: parseFloat((settings.track_in || 1), 10),
        trackFlowAt: 0.2, // 1.15,
        trackFastAt: 0.03, // 0.12,
        trackFormAt: 0.015, // 0.06,
        trackSampleAt: 0.035, // 0.12,
        trackCamAt: 0.002, // 0.008,
        trackSpawnAt: 0.045, // 0.18,

        mic: parseFloat((settings.mic_in || 1), 10),
        ...((''+settings.mic_track !== 'true')?
                {
                    micFlowAt: 0.5,
                    micFastAt: 0.8,
                    micFormAt: 0.5,
                    micSampleAt: 0.74,
                    micCamAt: 0.06,
                    micSpawnAt: 0.09
                }
            :   {
                    // Should be the same as track above... but the input values seem to
                    // differ when audio's rerouted to mic input.
                    // mic: parseFloat((settings.mic_in || 0.02), 10),
                    micFlowAt: 0.2, // 1.15,
                    micFastAt: 0.03, // 0.12,
                    micFormAt: 0.015, // 0.06,
                    micSampleAt: 0.035, // 0.12,
                    micCamAt: 0.002, // 0.008,
                    micSpawnAt: 0.045 // 0.18
                })
    };


    // Track

    const track = Object.assign(new Audio(), {
        crossOrigin: 'anonymous',
        className: 'track'
    });


    // Track control setup

    const trackControls = document.querySelector('.epok-audio-controls');

    const trackControl = (trackControls && {
        els: {
            main: trackControls,
            toggle: trackControls.querySelector('.epok-play-toggle'),
            progress: trackControls.querySelector('.epok-progress'),
            current: trackControls.querySelector('.epok-current'),
            total: trackControls.querySelector('.epok-total')
        },
        times: {
            current: new Date(0),
            total: new Date(0)
        },
        timeFormat: {
            second: 'numeric'
        },
        seeking: false,

        trackTimeChanged() {
            trackControl.els.progress.max = track.duration;

            const total = track.duration*1000;

            trackControl.times.total.setTime(total);

            trackControl.timeFormat.minute = ((total >= 60*1000)?
                'numeric' : undefined);

            trackControl.timeFormat.hour = ((total >= 60*60*1000)?
                'numeric' : undefined);

            trackControl.els.current.innerText = 0;

            trackControl.els.total.innerText = trackControl.times.total
                .toLocaleTimeString('en-gb', trackControl.timeFormat);
        },
        tick(time, paused) {
            trackControl.times.current.setTime(time);

            trackControl.els.current.innerText = trackControl.times.current
                .toLocaleTimeString('en-gb', trackControl.timeFormat);

            if(!trackControl.seeking) {
                trackControl.els.progress.value = time*0.001;
            }

            trackControl.els.toggle.checked = !paused;
        }
    });

    if(trackControl) {
        trackControl.els.main.parentElement.removeChild(trackControl.els.main);
        trackControl.els.main.appendChild(track);
        trackControl.els.main.classList.add('epok-show');

        track.addEventListener('durationchange', trackControl.trackTimeChanged);

        trackControl.els.toggle.addEventListener('change',
            () => ((trackControl.els.toggle.checked)?
                track.play() : track.pause()));

        trackControl.els.progress.addEventListener('pointerdown',
            () => trackControl.seeking = true);

        trackControl.els.progress.addEventListener('change', () => {
            if(trackControl.seeking) {
                track.currentTime = trackControl.els.progress.value;
                trackControl.seeking = false;
            }
        });
    }


    // Analyser setup

    // Convenience to mix in some things on top of the standard analyser setup.
    function makeAnalyser(...rest) {
        const a = analyser(...rest);
        const gain = a.gain = a.ctx.createGain();
        const out = (a.splitter || a.analyser);

        a.source.disconnect();
        a.source.connect(gain).connect(out);

        return a;
    }

    const audioState = { ...audioDefaults };

    // @todo Stereo - creates 2 separate analysers for each channel.
    // @todo Delay node to compensate for wait in analysing values?

    const trackAnalyser = makeAnalyser(track, { audible: audioState.audible });

    trackAnalyser.analyser.fftSize = Math.pow(2, 8);

    const trackTrigger = new AudioTrigger(trackAnalyser, 4);


    // Mic refs
    let micAnalyser;
    let micTrigger;


    // Track setup

    const setupTrack = (src, el = canvas.parentElement, onWindow = false) => {
        if(track.src !== src) {
            track.src = src;
            track.currentTime = 0;
        }

        if(trackControl) {
            const main = trackControl.els.main;

            if(main.parentElement !== el) {
                el.appendChild(main);
            }

            main.classList[((onWindow)? 'add' : 'remove')]('epok-on-window');
        }

        return track;
    };

    const setupTrackURL = (trackURL = appSettings.trackURL) => {
        const old = document.querySelector('.epok-soundcloud');

        if(old) {
            old.parentElement.removeChild(old);
        }

        if(trackURL) {
            if(trackURL.match(/^(https?)?(\:\/\/)?(www\.)?soundcloud\.com\//gi)) {
                // Special setup for SoundCloud links
                soundCloud({
                        client_id: '75aca2e2b815f9f5d4e92916c7b80846',
                        song: trackURL,
                        dark: false
                    },
                    (e, src, data, el) => {
                        if(e) {
                            console.warn('Error loading track', e);
                        }
                        else {
                            setupTrack(src, el.querySelector('.npm-scb-info'));
                            el.classList.add('epok-soundcloud');
                        }
                    });
            }
            else if(trackURL.match(/^(https)?(:\/\/)?(www\.)?dropbox\.com\/s\//gi)) {
                // Handle Dropbox share links
                setupTrack(trackURL.replace(/^((https)?(:\/\/)?(www\.)?)dropbox\.com\/s\/(.*)\?dl=(0)$/gi,
                        'https://dl.dropboxusercontent.com/s/$5?dl=1&raw=1'),
                    canvas.parentElement, true);
            }
            else {
                setupTrack(trackURL, canvas.parentElement, true);
            }
        }
    };

    setupTrackURL();


    // Flow inputs

    const flowInputs = new FlowLines(gl);

    const pointerFlow = (e) => {
        if(appSettings.pointerFlow) {
            /**
             * @todo Passing a `vec2` doesn't work - TypedArrays fail the test
             *       `offset` uses.
             */
            // const pos = offset(e, canvas, vec2.create());
            const pos = offset(e, canvas);

            pos[0] = mapRange(pos[0], 0, tendrils.viewRes[0], -1, 1);
            pos[1] = mapRange(pos[1], 0, tendrils.viewRes[1], 1, -1);

            flowInputs.get(e.pointerId).add(timer.app.time, pos);

            e.preventDefault();
        }
    };

    canvas.addEventListener('pointermove', pointerFlow, false);


    // Spwan feedback loop from flow
    /**
     * @todo The aspect ratio might be wrong here - always seems to converge on
     *       horizontal/vertical lines, like it were stretched.
     */

    const flowPixelSpawner = new spawnPixels.PixelSpawner(gl, {
            shader: [spawnPixels.defaults().shader[0], flowSampleFrag],
            buffer: tendrils.flow
        });

    const flowPixelScales = {
        'normal': [1, -1],
        // This flips the lookup, which is interesting (reflection)
        'mirror x': [-1, -1],
        'mirror y': [1, 1],
        'mirror xy': [-1, 1],
    };

    const flowPixelDefaults = {
        scale: 'mirror xy'
    };

    const flowPixelState = { ...flowPixelDefaults };

    function spawnFlow(buffer = spawnTargets.spawnFlow) {
        vec2.div(flowPixelSpawner.spawnSize,
            flowPixelScales[flowPixelState.scale], tendrils.viewSize);

        flowPixelSpawner.spawn(tendrils, undefined, buffer);
    }


    // Spawn on fastest particles.

    const simplePixelSpawner = new spawnPixels.PixelSpawner(gl, {
        shader: [spawnPixels.defaults().shader[0], dataSampleFrag],
        buffer: null
    });

    function spawnFastest(buffer = spawnTargets.spawnFastest) {
        simplePixelSpawner.buffer = tendrils.particles.buffers[0];
        simplePixelSpawner.spawnSize = tendrils.particles.shape;
        simplePixelSpawner.spawn(tendrils, undefined, buffer);
    }


    // Respawn from geometry (platonic forms)

    const geometrySpawner = new GeometrySpawner(gl, {
        speed: 0.005,
        bias: 100/0.005
    });

    const spawnForm = (buffer = spawnTargets.spawnForm) =>
        geometrySpawner.shuffle().spawn(tendrils, undefined, buffer);


    // Media - cam and mic

    const imageShaders = {
        direct: shader(gl, spawnPixels.defaults().shader[0], pixelsFrag),
        sample: shader(gl, spawnPixels.defaults().shader[0], bestSampleFrag)
    };

    const imageSpawner = new spawnPixels.PixelSpawner(gl, { shader: null });

    mat3.scale(imageSpawner.spawnMatrix,
        mat3.identity(imageSpawner.spawnMatrix), [-1, 1]);

    const rasterShape = {
        image: [0, 0],
        video: [0, 0]
    };

    let video = null;
    let mediaStream = null;


    const image = new Image();

    image.src = appSettings.staticImage;

    image.addEventListener('load',
        () => rasterShape.image = [image.width, image.height]);


    function spawnRaster(shader, speed, buffer) {
        imageSpawner.shader = shader;
        imageSpawner.speed = speed;

        let shape = rasterShape.image;
        let raster = image;

        if(appSettings.useMedia && video) {
            shape = rasterShape.video;
            raster = video;
        }

        imageSpawner.buffer.shape = tendrils.colorMap.shape = shape;

        imageSpawner.setPixels(raster);
        imageSpawner.spawn(tendrils, undefined, buffer);
    }

    const spawnImage = (buffer = spawnTargets.spawnImage) =>
        spawnRaster(imageShaders.direct, 0.3, buffer);

    const spawnSamples = (buffer = spawnTargets.spawnSamples) =>
        spawnRaster(imageShaders.sample, 1, buffer);


    // Optical flow

    const opticalFlow = new OpticalFlow(gl, undefined, {
        speed: parseFloat(settings.optical_speed || 0.08, 10),
        offset: 0.1
    });

    const opticalFlowState = {
        speed: opticalFlow.uniforms.speed,
        lambda: opticalFlow.uniforms.lambda,
        offset: opticalFlow.uniforms.offset
    };

    const opticalFlowDefaults = { ...opticalFlowState };


    // Media access

    function getMedia() {
        appSettings.useMedia = true;

        getUserMedia({
                video: true,
                audio: true
            },
            (e, stream) => {
                if(e) {
                    console.warn(e);
                }
                else {
                    mediaStream = stream;

                    const v = Object.assign(document.createElement('video'), {
                        src: self.URL.createObjectURL(stream),
                        srcObject: stream,
                        controls: true,
                        muted: true,
                        autoplay: true
                    });

                    v.addEventListener('canplay', () => {
                        video = v;
                        rasterShape.video = [v.videoWidth, v.videoHeight];
                    });

                    micAnalyser = (micAnalyser ||
                        makeAnalyser(stream, { audible: false }));

                    micAnalyser.analyser.fftSize = Math.pow(2, 8);

                    micTrigger = (micTrigger ||
                        new AudioTrigger(micAnalyser, 4));
                }
            });
    }

    function stopMedia(stream = mediaStream) {
        appSettings.useMedia = false;
        (stream && each((track) => track.stop(), stream.getTracks()));
    }

    const toggleMedia = (toggle = appSettings.useMedia) =>
        ((toggle)? getMedia : stopMedia)();

    if(appSettings.useMedia) {
        getMedia();
    }


    // Color map blending

    const audioTexture = new AudioTexture(gl,
            trackAnalyser.analyser.frequencyBinCount);

    const blend = new Blend(gl, {
        views: [audioTexture.texture, opticalFlow.buffers[0]],
        alphas: [0.3, 0.8]
    });


    // Audio `react` and `test` function pairs - for `AudioTrigger.fire`
    /**
     * @todo Separate these concerns, caching different kinds of audio response
     *       (frequencies, rate); while the callback is defined separately.
     *
     * @todo Move this cache stuff to `analyse` or a dedicated module, to handle
     *       more subtle cases (like one analysis of data being used by others)?
     *       Might need a cache per analysis function (WeakMap keyed on the
     *       array of data), or explicit string keys.
     */

    const audioCache = new Map();

    const audioFirer = (threshold, key, test) => (trigger) => {
            const t = threshold();

            if(t) {
                const cached = audioCache.get(key);

                if(cached) {
                    return cached;
                }
                else {
                    const value = test(trigger, t);

                    audioCache.set(key, value);

                    return value;
                }
            }
            else {
                return t;
            }
        };

    const trackFires = [
        [
            () => spawnFlow(),
            audioFirer(() => audioState.trackFlowAt,
                'trackFlowAt | Low end - velocity | meanWeight(track, 1, 0.25)',
                (trigger, t) => meanWeight(trigger.dataOrder(1), 0.25) > t)
        ],
        [
            () => spawnFastest(),
            audioFirer(() => audioState.trackFastAt,
                'trackFastAt | High end - acceleration | meanWeight(track, 2, 0.8)',
                (trigger, t) => meanWeight(trigger.dataOrder(2), 0.8) > t)
        ],
        [
            () => spawnForm(),
            audioFirer(() => audioState.trackFormAt,
                'trackFormAt | Sudden click/hit - force/attack | abs(peak(track, 3))',
                (trigger, t) => Math.abs(peak(trigger.dataOrder(3))) > t)
        ],
        [
            () => spawnSamples(),
            audioFirer(() => audioState.trackSampleAt,
                'trackSampleAt | Low end - acceleration | meanWeight(track, 2, 0.25)',
                (trigger, t) => meanWeight(trigger.dataOrder(2), 0.25) > t)
        ],
        [
            () => spawnImage(),
            audioFirer(() => audioState.trackCamAt,
                'trackCamAt | Mid - force/attack | meanWeight(track, 3, 0.5)',
                (trigger, t) => meanWeight(trigger.dataOrder(3), 0.5) > t)
        ],
        [
            () => restart(),
            audioFirer(() => audioState.trackSpawnAt,
                'trackSpawnAt | Low end - acceleration | meanWeight(track, 3, 0.25)',
                (trigger, t) => meanWeight(trigger.dataOrder(2), 0.25) > t)
        ]
    ];

    const micFires = ((''+settings.mic_track === 'true')?
            [
                [
                    () => spawnFlow(),
                    audioFirer(() => audioState.micFlowAt,
                        'micFlowAt | Low end - velocity | meanWeight(mic, 1, 0.25)',
                        (trigger, t) => meanWeight(trigger.dataOrder(1), 0.25) > t)
                ],
                [
                    () => spawnFastest(),
                    audioFirer(() => audioState.micFastAt,
                        'micFastAt | High end - acceleration | meanWeight(mic, 2, 0.8)',
                        (trigger, t) => meanWeight(trigger.dataOrder(2), 0.8) > t)
                ],
                [
                    () => spawnForm(),
                    audioFirer(() => audioState.micFormAt,
                        'micFormAt | Sudden click/hit - force/attack | abs(peak(mic, 3))',
                        (trigger, t) => Math.abs(peak(trigger.dataOrder(3))) > t)
                ],
                [
                    () => spawnSamples(),
                    audioFirer(() => audioState.micSampleAt,
                        'micSampleAt | Low end - acceleration | meanWeight(mic, 2, 0.25)',
                        (trigger, t) => meanWeight(trigger.dataOrder(2), 0.25) > t)
                ],
                [
                    () => spawnImage(),
                    audioFirer(() => audioState.micCamAt,
                        'micCamAt | Mid - force/attack | meanWeight(mic, 3, 0.5)',
                        (trigger, t) => meanWeight(trigger.dataOrder(3), 0.5) > t)
                ],
                [
                    () => restart(),
                    audioFirer(() => audioState.micSpawnAt,
                        'micSpawnAt | Low end - acceleration | meanWeight(mic, 3, 0.25)',
                        (trigger, t) => meanWeight(trigger.dataOrder(2), 0.25) > t)
                ]
            ]
        :   [
                [
                    () => spawnFlow(),
                    audioFirer(() => audioState.micFlowAt,
                        'micFlowAt | Low end - velocity | meanWeight(mic, 1, 0.3)',
                        (trigger, t) => meanWeight(trigger.dataOrder(1), 0.3) > t)
                ],
                [
                    () => spawnFastest(),
                    audioFirer(() => audioState.micFastAt,
                        'micFastAt | High end - velocity | meanWeight(mic, 1, 0.7)',
                        (trigger, t) => meanWeight(trigger.dataOrder(1), 0.7) > t)
                ],
                [
                    () => spawnForm(),
                    audioFirer(() => audioState.micFormAt,
                        'micFormAt | Sudden click/hit - acceleration | abs(peak(mic, 2))',
                        (trigger, t) => Math.abs(peak(trigger.dataOrder(2))) > t)
                ],
                [
                    () => spawnSamples(),
                    audioFirer(() => audioState.micSampleAt,
                        'micSampleAt | Mid - velocity | meanWeight(mic, 1, 0.4)',
                        (trigger, t) => meanWeight(trigger.dataOrder(1), 0.4) > t)
                ],
                [
                    () => spawnImage(),
                    audioFirer(() => audioState.micCamAt,
                        'micCamAt | Mid - acceleration | meanWeight(mic, 2, 0.6)',
                        (trigger, t) => meanWeight(trigger.dataOrder(2), 0.6) > t)
                ],
                [
                    () => restart(),
                    audioFirer(() => audioState.micSpawnAt,
                        'micSpawnAt | Low end - acceleration | meanWeight(mic, 2, 0.3)',
                        (trigger, t) => meanWeight(trigger.dataOrder(2), 0.3) > t)
                ]
            ]);

    // Returns a function to be executed for each `fire` pair (as above)
    const audioResponder = (trigger) => (fire) => trigger.fire(...fire);

    let trackResponder;
    let micResponder;

    const audioResponse = () => {
        // Sequential, and only one at a time, to calm the audio response
        let soundOutput = false;

        if(audioState.track > 0 && !track.paused) {
            soundOutput = trackFires.some(trackResponder ||
                (trackResponder = audioResponder(trackTrigger)));
        }

        if(!soundOutput && audioState.mic > 0 && micTrigger) {
            soundOutput = micFires.some(micResponder ||
                (micResponder = audioResponder(micTrigger)));
        }

        audioCache.clear();

        return soundOutput;
    };


    // Screen effects

    const screen = new Screen(gl);


    // Blur vignette

    const blurShader = shader(gl, screenVert, blurFrag);

    const blurDefaults = {
        radius: 3,
        limit: 0.5
    };

    const blurState = {
        radius: 8,
        limit: 0.2
    };

    blurShader.bind();
    Object.assign(blurShader.uniforms, blurState);


    // Background

    function toggleBase(background) {
        if(!background) {
            background = ((canvas.classList.contains('epok-dark'))? 'light' : 'dark');
        }

        canvas.classList.remove('epok-light');
        canvas.classList.remove('epok-dark');

        canvas.classList.add('epok-'+background);
    }


    // Animation setup

    const tracks = {
        tendrils: tendrils.state,
        tendrils2: tendrils.state,
        tendrils3: tendrils.state,
        baseColor: tendrils.state.baseColor,
        flowColor: tendrils.state.flowColor,
        fadeColor: tendrils.state.fadeColor,
        spawn: resetSpawner.uniforms,
        opticalFlow: opticalFlowState,
        audio: audioState,
        blend: blend.alphas,
        blur: blurState,
        // Just for calls
        // @todo Fix the animation lib properly, not just by convention
        calls: {}
    };

    const player = {
        // The main player, tied to the track time
        track: new Player(map(() => [], tracks, {}), tracks),

        // A miscellaneous player, time to app time
        app: new Player({ main: [] }, { main: tendrils.state })
    };

    // timer.track.end = player.track.end()+2000;
    // timer.track.loop = true;

    track.addEventListener('seeked',
        () => (appSettings.animate &&
            player.track.playFrom(track.currentTime*1000, 0)));


    // @todo Test sequence - move to own file?

    // The values to reset everything to on restart - commented-out ones are
    // omitted so global settings can be applied more easily.
    // Use this as a guide to see which track should change which values.
    const tracksStart = {
        tendrils: {
            // rootNum: 512,

            autoClearView: false,
            autoFade: true,

            // damping: 0.043,
            // speedLimit: 0.01,

            forceWeight: 0.016,
            varyForce: -0.25,

            flowWeight: 1,
            varyFlow: 0.3,

            flowDecay: 0.003,
            flowWidth: 5,

            speedAlpha: 0.0005,
            colorMapAlpha: 0.85
        },
        tendrils2: {
            noiseWeight: 0.0003,
            varyNoise: 0.3,

            noiseScale: 1.5,
            varyNoiseScale: 1,

            noiseSpeed: 0.0006,
            varyNoiseSpeed: 0.05,
        },
        tendrils3: {
            target: 0.000005,
            varyTarget: 1,
            lineWidth: 1
        },
        baseColor: [1, 1, 1, 0.9],
        flowColor: [1, 1, 1, 0.1],
        fadeColor: [0, 0, 0, 0.1],
        spawn: {
            radius: 0.9,
            speed: 0.05
        },
        opticalFlow: { ...opticalFlowDefaults },
        audio: { ...audioDefaults },
        blend: [0, 1],
        blur: { ...blurState },
        calls: null
    };

    // Restart, clean slate; begin with the inert, big bang - flow only

    const trackStartTime = 60;

    player.track.tracks.calls.to({
            call: [() => reset()],
            time: trackStartTime
        })
        .to({
            call: [
                () => {
                    restart();
                    toggleBase('dark');
                }
            ],
            time: 200
        });

    player.track.apply((track, key) => {
        const apply = tracksStart[key];

        track.to({
            to: apply,
            time: trackStartTime
        });

        return { apply };
    });


    // Intro info

    const intro = {
        togglers: Array.from(document.querySelectorAll('.epok-info-more-button')),
        more: document.querySelector('.epok-info-more'),

        toggle(toggle) {
            const show = ((typeof toggle !== 'undefined')?
                    toggle
                :   intro.more.classList.contains('epok-hide'));

            if(show) {
                intro.more.classList.remove('epok-hide');
            }
            else {
                intro.more.classList.add('epok-hide');
            }
        }
    };

    intro.togglers.forEach((moreToggler) =>
        moreToggler.addEventListener('click', () => intro.toggle()));


    // Quality settings

    const quality = {
        options: [
            {
                rootNum: defaultState.rootNum,
                damping: defaultState.damping
            },
            {
                rootNum: defaultState.rootNum*2,
                damping: defaultState.damping-0.001
            }
        ],
        level: parseInt((settings.quality ||
                ((Math.max(window.innerWidth, window.innerHeight) < 800)? 0 : 1)),
            10),

        change(level = (quality.level+1)%quality.options.length) {
            const settings = quality.options[level];

            tendrils.setup(settings.rootNum);
            Object.assign(state, settings);
            restart();

            quality.level = level;
        },
        step: () => quality.change()
    };

    quality.change(quality.level);


    // Fullscreen

    // Needs to be called this way because calling the returned function directly is an
    // `Illegal Invocation`
    const requestFullscreen = prefixes('requestFullscreen', canvas);

    const fullscreen = (requestFullscreen && requestFullscreen.name && {
        request: () => canvas[requestFullscreen.name]()
    });


    // The main loop
    function render() {
        const dt = timer.app.tick().dt;

        player.app.play(timer.app.time);

        if(track && track.currentTime >= 0) {
            timer.track.tick(track.currentTime*1000);

            if(appSettings.animate) {
                player.track.play(timer.track.time);
            }

            if(trackControl) {
                trackControl.tick(timer.track.time, track.paused);
            }
        }

        /**
         * @todo Spectogram with frequencies on x-axis, waveform on y; or
         *       something better than this 1D list.
         */
        audioTexture.frequencies(trackTrigger.dataOrder(0)).apply();

        // Blend the color maps into tendrils one
        // @todo Only do this if necessary (skip if none or only one has alpha)

        blend.views[1] = ((appSettings.useMedia && video)?
                opticalFlow.buffers[0]
            :   imageSpawner.buffer);

        blend.draw(tendrils.colorMap);

        // The main event
        tendrils.step().draw();

        if(tendrils.buffers.length) {
            // Blur to the screen

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            tendrils.drawFade();

            blurShader.bind();

            Object.assign(blurShader.uniforms, {
                    view: tendrils.buffers[0].color[0].bind(1),
                    resolution: tendrils.viewRes,
                    time: tendrils.timer.time
                },
                blurState);

            screen.render();

            tendrils.stepBuffers();
        }


        // Draw inputs to flow

        gl.viewport(0, 0, ...tendrils.flow.shape);

        tendrils.flow.bind();


        // Flow lines

        flowInputs.trim(1/tendrils.state.flowDecay, timer.app.time);

        if(appSettings.pointerFlow) {
            each((flowLine) => {
                    Object.assign(flowLine.line.uniforms, tendrils.state);
                    flowLine.update().draw();
                },
                flowInputs.active);
        }


        // Optical flow

        // @todo Replace the image color map with one of these textures updated each frame.
        // @todo Blur for optical flow? Maybe Sobel as well?
        // @see https://github.com/princemio/ofxMIOFlowGLSL/blob/master/src/ofxMioFlowGLSL.cpp

        if(appSettings.useMedia && video) {
            opticalFlow.resize(rasterShape.video);
            opticalFlow.setPixels(video);

            if(opticalFlowState.speed) {
                opticalFlow.update({
                    speedLimit: state.speedLimit,
                    time: timer.app.time,
                    viewSize: tendrils.viewSize,
                    ...opticalFlowState
                });

                screen.render();
            }

            opticalFlow.step();
        }


        // React to sound - from highest reaction to lowest, max one per frame

        if(trackTrigger) {
            trackAnalyser.gain.gain
                // So we don't blow any speakers...
                .linearRampToValueAtTime(clamp(audioState.track, 0, 1),
                    trackAnalyser.ctx.currentTime+0.5);

            trackTrigger.sample(dt);
        }

        if(micTrigger) {
            micAnalyser.gain.gain
                .linearRampToValueAtTime(clamp(audioState.mic, 0, 10000),
                    micAnalyser.ctx.currentTime+0.5);

            micTrigger.sample(dt);
        }

        audioResponse();
    }


    function resize() {
        canvas.width = self.innerWidth;
        canvas.height = self.innerHeight;

        tendrils.resize();
    }

    // Go

    self.addEventListener('resize', throttle(resize, 200), false);

    resize();

    tendrils.setup();
    respawn();


    // Control panel

    const gui = {
        main: new dat.GUI({ autoPlace: false }),
        showing: (''+settings.edit !== 'false'),
        toggle: document.querySelector('.epok-editor-button')
    };

    const containGUI = Object.assign(document.createElement('div'), {
            className: 'epok-edit-controls'
        });

    const preventKeyClash = (e) => e.stopPropagation();

    gui.main.domElement.addEventListener('keydown', preventKeyClash);
    gui.main.domElement.addEventListener('keyup', preventKeyClash);

    function updateGUI(node = gui.main) {
        if(node.__controllers) {
            node.__controllers.forEach((control) => control.updateDisplay());
        }

        for(let f in node.__folders) {
            updateGUI(node.__folders[f]);
        }
    }

    function toggleOpenGUI(open, node = gui.main, cascade = true) {
        ((open)? node.open() : node.close());

        if(cascade) {
            for(let f in node.__folders) {
                toggleOpenGUI(open, node.__folders[f]);
            }
        }
    }

    function toggleShowGUI(show = !gui.showing) {
        containGUI.classList[(show)? 'remove' : 'add']('epok-hide');
        gui.showing = show;
    }

    (gui.toggle &&
        gui.toggle.addEventListener('click', () => toggleShowGUI()));

    // Types of simple properties the GUI can handle with `.add`
    const simpleGUIRegEx = /^(object|array|undefined|null)$/gi;


    // Info

    const proxyGUI = {
        info: intro.toggle
    };

    gui.main.add(proxyGUI, 'info');


    // Root level

    const rootControls = {
        changeQuality: quality.step
    };

    if(fullscreen) {
        rootControls.fullscreen = fullscreen.request;
    }


    // State, animation, import/export

    const keyframe = (to = { ...state }, call = null) =>
        // @todo Apply full state to each player track
        player.track.tracks.tendrils.smoothTo({
            to,
            call,
            time: timer.track.time,
            ease: [0, 0.95, 1]
        });

    const showExport = ((''+settings.prompt_show !== 'false')?
            (...rest) => self.prompt(...rest)
        :   (...rest) => console.log(...rest));

    Object.assign(rootControls, {
            showLink: () => showExport('Link:',
                location.href.replace((location.search || /$/gi),
                    '?'+querystring.encode({
                        ...settings,
                        track: encodeURIComponent(appSettings.trackURL),
                        mute: !audioState.audible,
                        track_in: audioState.track,
                        mic_in: audioState.mic,
                        use_media: appSettings.useMedia,
                        animate: appSettings.animate
                    }))),
            showState: () => showExport(`Current state (@${timer.track.time}):`,
                toSource(player.track.tracks)),
            showSequence: () => showExport('Animation sequence:',
                toSource(player.track.frames({}))),

            keyframe
        });


    gui.main.add(appSettings, 'trackURL').onFinishChange(setupTrackURL);

    gui.main.add(appSettings, 'animate');

    gui.main.add(appSettings, 'useMedia').onFinishChange(() => toggleMedia());

    gui.main.add(appSettings, 'staticImage').onFinishChange(() =>
            image.src = appSettings.staticImage);

    each((f, control) => gui.main.add(rootControls, control), rootControls);


    // Settings

    gui.settings = gui.main.addFolder('settings');

    for(let s in state) {
        if(!(typeof state[s]).match(simpleGUIRegEx)) {
            const control = gui.settings.add(state, s);

            // Some special cases

            if(s === 'rootNum') {
                control.onFinishChange((n) => {
                    tendrils.setup(n);
                    restart();
                });
            }
        }
    }


    // DAT.GUI's color controllers are a bit fucked.

    const colorDefaults = {
            baseColor: state.baseColor.slice(0, 3).map((c) => c*255),
            baseAlpha: state.baseColor[3],

            flowColor: state.flowColor.slice(0, 3).map((c) => c*255),
            flowAlpha: state.flowColor[3],

            fadeColor: state.fadeColor.slice(0, 3).map((c) => c*255),
            fadeAlpha: state.fadeColor[3]
        };

    const colorProxy = {...colorDefaults};

    const convertColors = () => {
        state.baseColor[3] = colorProxy.baseAlpha;
        Object.assign(state.baseColor,
                colorProxy.baseColor.map((c) => c/255));

        state.flowColor[3] = colorProxy.flowAlpha;
        Object.assign(state.flowColor,
            colorProxy.flowColor.map((c) => c/255));

        state.fadeColor[3] = colorProxy.fadeAlpha;
        Object.assign(state.fadeColor,
            colorProxy.fadeColor.map((c) => c/255));
    };

    gui.settings.addColor(colorProxy, 'flowColor').onChange(convertColors);
    gui.settings.add(colorProxy, 'flowAlpha').onChange(convertColors);

    gui.settings.addColor(colorProxy, 'baseColor').onChange(convertColors);
    gui.settings.add(colorProxy, 'baseAlpha').onChange(convertColors);

    gui.settings.addColor(colorProxy, 'fadeColor').onChange(convertColors);
    gui.settings.add(colorProxy, 'fadeAlpha').onChange(convertColors);

    convertColors();


    // Color map blend

    gui.blend = gui.main.addFolder('color blend');

    const blendKeys = ['audio', 'video'];
    const blendProxy = reduce((proxy, k, i) => {
            proxy[k] = blend.alphas[i];

            return proxy;
        },
        blendKeys, {});

    const blendDefaults = { ...blendProxy };

    const convertBlend = () => reduce((alphas, v, k, proxy, i) => {
            alphas[i] = v;

            return alphas;
        },
        blendProxy, blend.alphas);

    for(let b = 0; b < blendKeys.length; ++b) {
        gui.blend.add(blendProxy, blendKeys[b]).onChange(convertBlend);
    }


    // Respawn

    gui.spawn = gui.main.addFolder('spawn');

    for(let s in resetSpawner.uniforms) {
        if(!(typeof resetSpawner.uniforms[s]).match(simpleGUIRegEx)) {
            gui.spawn.add(resetSpawner.uniforms, s);
        }
    }

    const resetSpawnerDefaults = {
        radius: 0.3,
        speed: 0.005
    };


    // Optical flow

    gui.opticalFlow = gui.main.addFolder('optical flow');

    for(let s in opticalFlowState) {
        if(!(typeof opticalFlowState[s]).match(simpleGUIRegEx)) {
            gui.opticalFlow.add(opticalFlowState, s);
        }
    }


    // Reflow

    gui.reflow = gui.main.addFolder('reflow');

    gui.reflow.add(flowPixelState, 'scale', Object.keys(flowPixelScales));


    // Time

    gui.time = gui.main.addFolder('time');

    const timeSettings = ['paused', 'step', 'rate', 'end', 'loop'];

    timeSettings.forEach((t) => gui.time.add(timer.app, t));


    // Audio

    gui.audio = gui.main.addFolder('audio');

    for(let s in audioState) {
        const control = gui.audio.add(audioState, s);

        if(s === 'audible') {
            control.onChange((v) => {
                const out = (trackAnalyser.merger || trackAnalyser.analyser);

                if(v) {
                    out.connect(trackAnalyser.ctx.destination);
                }
                else {
                    out.disconnect();
                }
            });
        }
    }


    // Blur

    gui.blur = gui.main.addFolder('blur');

    for(let s in blurDefaults) {
        if(!(typeof blurState[s]).match(simpleGUIRegEx)) {
            gui.blur.add(blurState, s);
        }
    }


    // Controls

    const controllers = {
        clear,
        clearView,
        clearFlow,
        respawn,
        spawnSamples,
        spawnImage,
        spawnFlow,
        spawnFastest,
        spawnForm,
        reset,
        restart,
        toggleBase
    };


    gui.controls = gui.main.addFolder('controls');

    for(let c in controllers) {
        gui.controls.add(controllers, c);
    }


    // Presets

    gui.presets = gui.main.addFolder('presets');

    const presetters = {
        'Flow'() {
            Object.assign(state, {
                flowWidth: 5,
                colorMapAlpha: 0
            });

            Object.assign(resetSpawner.uniforms, {
                radius: 0.25,
                speed: 0.01
            });

            Object.assign(colorProxy, {
                baseAlpha: 0,
                baseColor: [0, 0, 0],
                flowAlpha: 1,
                flowColor: [255, 255, 255],
                fadeAlpha: Math.max(state.flowDecay, 0.05)
            });
        },
        'Wings'() {
            Object.assign(state, {
                flowDecay: 0,
                colorMapAlpha: 0
            });

            Object.assign(resetSpawner.uniforms, {
                radius: 0.05,
                speed: 0.05
            });

            Object.assign(colorProxy, {
                flowAlpha: 0.01,
                baseAlpha: 0.8,
                fadeAlpha: 0
            });

            restart();
        },
        'Fluid'() {
            Object.assign(state, {
                autoClearView: true
            });

            Object.assign(colorProxy, {
                fadeAlpha: 0
            });

            clear();
        },
        'Flow only'() {
            Object.assign(state, {
                flowDecay: 0.001,
                forceWeight: 0.014,
                noiseWeight: 0,
                speedAlpha: 0
            });

            Object.assign(resetSpawner.uniforms, {
                radius: 0.4,
                speed: 0.15
            });

            Object.assign(colorProxy, {
                baseAlpha: 0.8,
                baseColor: [100, 200, 255],
                fadeAlpha: 0.1
            });
        },
        'Noise only'() {
            Object.assign(state, {
                flowWeight: 0,
                noiseWeight: 0.003,
                noiseSpeed: 0.0005,
                noiseScale: 1.5,
                varyNoiseScale: 10,
                varyNoiseSpeed: 0.05,
                speedAlpha: 0,
                colorMapAlpha: 0.8
            });

            Object.assign(colorProxy, {
                baseAlpha: 0.4,
                baseColor: [255, 150, 0],
                fadeAlpha: 0.05,
                flowAlpha: 0
            });

            Object.assign(blendProxy, {
                audio: 0.9,
                video: 0
            });
        },
        'Sea'() {
            Object.assign(state, {
                flowWidth: 5,
                forceWeight: 0.013,
                noiseWeight: 0.002,
                flowDecay: 0.01,
                speedAlpha: 0,
                colorMapAlpha: 0.4
            });

            Object.assign(resetSpawner.uniforms, {
                radius: 1.5,
                speed: 0
            });

            Object.assign(colorProxy, {
                baseAlpha: 0.8,
                baseColor: [55, 155, 255],
                fadeAlpha: 0.3,
                fadeColor: [0, 58, 90]
            });
        },
        'Ghostly'() {
            Object.assign(state, {
                flowDecay: 0,
                colorMapAlpha: 0.005
            });

            Object.assign(colorProxy, {
                baseAlpha: 0.25,
                baseColor: [255, 255, 255],
                flowAlpha: 0.03,
                fadeAlpha: 0.03,
                fadeColor: [0, 0, 0]
            });
        },
        'Petri'() {
            Object.assign(state, {
                forceWeight: 0.015,
                noiseWeight: 0.001,
                flowDecay: 0.001,
                noiseScale: 200,
                noiseSpeed: 0.0001
            });

            Object.assign(colorProxy, {
                baseAlpha: 0.4,
                baseColor:[255, 203, 37],
                flowAlpha: 0.05,
                fadeAlpha: 0.03
            });

            Object.assign(resetSpawner.uniforms, {
                radius: 1/Math.max(...tendrils.viewSize),
                speed: 0
            });
        },
        'Turbulence'() {
            Object.assign(state, {
                noiseSpeed: 0.00005,
                noiseScale: 10,
                forceWeight: 0.014,
                noiseWeight: 0.003,
                speedAlpha: 0.000002,
                colorMapAlpha: 0.3
            });

            Object.assign(colorProxy, {
                baseAlpha: 0.3,
                baseColor: [100, 0, 0],
                flowAlpha: 0.5,
                flowColor: [255, 10, 10],
                fadeAlpha: 0.01,
                fadeColor: [0, 0, 0]
            });
        },
        'Rorschach'() {
            Object.assign(state, {
                noiseScale: 40,
                varyNoiseScale: 0.1,
                noiseSpeed: 0.00001,
                varyNoiseSpeed: 0.01,
                forceWeight: 0.014,
                noiseWeight: 0.0021,
                speedAlpha: 0.000002,
                colorMapAlpha: 0.2
            });

            Object.assign(flowPixelState, {
                scale: 'mirror xy'
            });

            Object.assign(colorProxy, {
                baseAlpha: 0.9,
                baseColor: [0, 0, 0],
                flowAlpha: 0.1,
                fadeAlpha: 0.05,
                fadeColor: [255, 255, 255]
            });
        },
        'Roots'() {
            Object.assign(state, {
                flowDecay: 0,
                noiseSpeed: 0,
                noiseScale: 18,
                forceWeight: 0.015,
                noiseWeight: 0.0023,
                speedAlpha: 0.00005,
                lineWidth: 2,
                colorMapAlpha: 0.0001
            });

            Object.assign(colorProxy, {
                baseAlpha: 0.2,
                baseColor: [50, 255, 50],
                flowAlpha: 0.05,
                fadeAlpha: 0
            });
        },
        'Funhouse'() {
            Object.assign(state, {
                forceWeight: 0.0165,
                varyForce: 0.3,
                flowWeight: 0.5,
                varyFlow: 1,
                noiseWeight: 0.0015,
                varyNoise: 1,
                noiseScale: 40,
                varyNoiseScale: -4,
                noiseSpeed: 0.0001,
                varyNoiseSpeed: -3,
                flowDecay: 0.001,
                flowWidth: 8,
                speedAlpha: 0.00002,
                colorMapAlpha: 1
            });

            Object.assign(colorProxy, {
                baseAlpha: 0.2,
                baseColor: [0, 0, 0],
                flowAlpha: 0.05,
                fadeAlpha: 0.05,
                fadeColor: [0, 0, 0]
            });

            spawnImage(null);
        }
    };

    const wrapPresetter = (presetter) => {
        Object.assign(state, defaultState);
        Object.assign(resetSpawner.uniforms, resetSpawnerDefaults);
        Object.assign(flowPixelState, flowPixelDefaults);
        Object.assign(colorProxy, colorDefaults);
        Object.assign(blendProxy, blendDefaults);

        presetter();

        updateGUI();
        convertColors();
        convertBlend();
        // restart();
    };

    for(let p in presetters) {
        presetters[p] = wrapPresetter.bind(null, presetters[p]);
        gui.presets.add(presetters, p);
    }


    // Hide by default till the animation's over

    toggleOpenGUI(true);
    toggleOpenGUI(false, undefined, false);
    toggleShowGUI(gui.showing);

    // Add to the DOM

    containGUI.appendChild(gui.main.domElement);
    canvas.parentElement.appendChild(containGUI);


    // Keyboard mash!
    /**
     * Assign modifiers to keys:
     * - Hold down a letter key to select a setting:
     *     - Up/down key to raise/lower it a little.
     *     - Left/right key to raise/lower it a lot.
     *     - Backspace to reset it to its default.
     *     - Release it to record a frame.
     * - Spacebar for cam.
     * - Shift/ctrl/cmd for spawning.
     * - Numbers for presets.
     * - Symbols for smashing shapes/colours into the flow.
     *
     * Tween these with a default ease and duration (keyframe pair).
     * Edit the timeline for each setting, saving the settings on each
     * change into a keyframe (pair with default duration).
     *
     * @todo Playing with some functional stuff here, looks pretty mad.
     * @todo Smash in some shapes, flow inputs, colour inputs (discrete forms).
     * @todo Increment/decrement state values by various amounts.
     * @todo Use the above to play the visuals and set keyframes in real time?
     */
    function keyMash() {
        // Quick track control

        const togglePlay = (play = track.paused) =>
            ((play)? track.play() : track.pause());

        const scrub = (by) => {
            track.currentTime += by*0.001;
            togglePlay(true);
        };


        const keyframeCall = (...calls) => {
            keyframe(null, calls);
            each((call) => call(), calls);
        };

        const keyframeCaller = (...calls) => () => keyframeCall(...calls);


        // Invoke the functions for each setting being edited.
        const resetEach = (all) => {
                each((x) => (x.reset && x.reset()), all);
                updateGUI();
            };

        const adjustEach = curry((by, all) => {
                each((x) => (x.adjust && x.adjust(by)), all);
                updateGUI();
            });


        // Common case for editing a given setting.

        const copy = (into, source, key) => into[key] = source[key];
        const copier = curry(copy, copy.length+1);

        const adjust = (into, key, scale, by) => into[key] += scale*by;
        const adjuster = curry(adjust);

        const flip = (into, key) => into[key] = !into[key];
        const flipper = curry(flip, flip.length+1);


        // Shorthands

        const stateCopy = copier(state, defaultState);
        const stateEdit = adjuster(state);
        const stateFlip = flipper(state);

        const stateBool = (key) => ({
            reset: stateCopy(key),
            go: stateFlip(key)
        });

        const stateNum = (key, scale) => ({
            reset: stateCopy(key),
            adjust: stateEdit(key, scale)
        });


        const editing = {};

        /**
         * Anything that selects and may change a part of the state.
         * @todo Inputs for the other things in full state, controls, and
         *       presets.
         */
        const editMap = {

            '`': {
                reset: () => {
                    tendrils.setup(defaultState.rootNum);
                    restart();
                },
                adjust: (by) => {
                    tendrils.setup(state.rootNum*Math.pow(2, by));
                    restart();
                }
            },

            'P': stateBool('autoClearView'),

            'Q': stateNum('forceWeight', 0.01),
            'A': stateNum('flowWeight', 0.02),
            'W': stateNum('noiseWeight', 0.0002),

            'S': stateNum('flowDecay', 0.005),
            'D': stateNum('flowWidth', 1),

            'E': stateNum('noiseScale', 1),
            'R': stateNum('noiseSpeed', 0.002),

            'Z': stateNum('damping', 0.001),
            'X': stateNum('speedLimit', 0.0001),

            'N': stateNum('speedAlpha', 0.002),
            'M': stateNum('lineWidth', 0.1),

            // <control> is a special case for re-assigning keys, see below
            '<control>': (key, assign) => {
                delete editMap[key];
                delete callMap[key];

                callMap[key] = keyframeCaller(() =>
                        Object.assign(state, assign));
            }
        };

        const callMap = {
            'H': () => toggleShowGUI(),

            'O': keyframeCaller(() => tendrils.clear()),

            '0': keyframeCaller(presetters['Flow']),
            '1': keyframeCaller(presetters['Wings']),
            '2': keyframeCaller(presetters['Fluid']),
            '3': keyframeCaller(presetters['Flow only']),
            '4': keyframeCaller(presetters['Noise only']),
            '5': keyframeCaller(presetters['Sea']),
            '6': keyframeCaller(presetters['Petri']),
            '7': keyframeCaller(presetters['Turbulence']),
            '8': keyframeCaller(presetters['Rorschach']),
            '9': keyframeCaller(presetters['Funhouse']),

            '-': adjustEach(-0.1),
            '=': adjustEach(0.1),
            '<down>': adjustEach(-1),
            '<up>': adjustEach(1),
            '<left>': adjustEach(-5),
            '<right>': adjustEach(5),

            '<escape>': (...rest) => {
                resetEach(editMap);
                keyframe(...rest);
            },
            '<caps-lock>': resetEach,

            '<space>': () => togglePlay(),

            '[': () => scrub(-2000),
            ']': () => scrub(2000),
            '<enter>': keyframe,
            // @todo Update this to match the new Player API
            '<backspace>': () =>
                player.track.trackAt(timer.track.time)
                    .spliceAt(timer.track.time),

            '\\': keyframeCaller(() => reset()),
            "'": keyframeCaller(() => spawnFlow()),
            ';': keyframeCaller(() => spawnFastest()),
            ',': keyframeCaller(() => spawnForm()),

            '<shift>': keyframeCaller(() => restart()),
            '/': keyframeCaller(() => spawnSamples()),
            '.': keyframeCaller(() => spawnImage(null))
        };

        if(fullscreen) {
            callMap['F'] = fullscreen.request;
        }

        // @todo Throttle so multiple states can go into one keyframe.
        // @todo Toggle this on or off any time - from GUI flag etc.
        document.body.addEventListener('keydown', (e) => {
                // Control is a special case to assign the current state to
                // a key.
                const remap = editing['<control>'];
                const key = vkey[e.keyCode];
                const mapped = editMap[key];
                const call = callMap[key];

                if(remap) {
                    remap(key, { ...state });
                }
                else if(mapped && !editing[key]) {
                    editing[key] = mapped;

                    if(mapped.go) {
                        mapped.go(editing, state);
                    }
                }
                else if(call) {
                    call(editing, state);
                }

                updateGUI();

                if(mapped || call) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            },
            false);

        document.body.addEventListener('keyup',
            (e) => {
                const key = vkey[e.keyCode];
                const mapped = editMap[key];
                const call = callMap[key];

                if(mapped && editing[key]) {
                    if(key !== '<control>' && !editing['<control>']) {
                        keyframe({ ...state });
                    }

                    // @todo Needed?
                    editing[key] = null;
                    delete editing[key];
                }

                if(mapped || call) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            },
            false);
    }

    if(''+settings.keyboard !== 'false') {
        keyMash();
    }

    // Need some stuff exposed.
    // @todo Come up with a better interface than this.
    const out = {
        ...controllers,
        tendrils,
        tracks,
        defaultState,
        audioDefaults,
        toggleMedia
    };

    // Debug
    window.tendrils = out;

    return out;
};
