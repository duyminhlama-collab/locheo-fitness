(() => {
    'use strict';
    const WHEEL_THRESHOLD = 40, GESTURE_GAP = 280;
    let deck, cleanup, refresh;
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

    function mount(root) {
        const controller = new AbortController();
        const on = (type, fn, options = {}) => root.addEventListener(type, fn, {...options, signal: controller.signal});
        let cards = [], active = 0, frame = 0, touch = null;
        let wheelLast = 0, wheelSum = 0, wheelUsed = false, movingUntil = 0;
        let suppressClickUntil = 0;
        const topInset = card => Math.max(16, (root.clientHeight - card.offsetHeight) / 2);
        const bounds = index => {
            const card = cards[index];
            if (!card) return {start: 0, end: 0};
            const top = card.offsetTop;
            const start = Math.max(0, top - topInset(card));
            return {start, end: Math.max(start, top + card.offsetHeight - root.clientHeight + 16)};
        };
        const shades = new WeakMap();
        let paintedCards, paintedActive, paintedPosition, cachedRanges, paintedLayer;
        let layerAnchor = 0;
        function paint(position = root.scrollTop) {
            frame = 0;
            if (paintedCards === cards && paintedActive === active && paintedPosition === position && paintedLayer === layerAnchor) return;
            const selectionChanged = paintedCards !== cards || paintedActive !== active;
            paintedCards = cards;
            paintedActive = active;
            paintedPosition = position;
            paintedLayer = layerAnchor;
            // Read geometry before changing styles.
            const ranges = cachedRanges || (cachedRanges = cards.map((_, index) => bounds(index)));
            let visualIndex = 0;
            for (let index = 0; index < ranges.length; index++) {
                if (position >= ranges[index].start) visualIndex = index;
                if (index + 1 < ranges.length && position > ranges[index].end &&
                    position < ranges[index + 1].start) {
                    visualIndex = index + (position - ranges[index].end) /
                        Math.max(1, ranges[index + 1].start - ranges[index].end);
                    break;
                }
            }
            cards.forEach((card, index) => {
                const distance = Math.abs(index - visualIndex);
                const hidden = distance >= 3;
                const visibility = hidden ? 'hidden' : '';
                if (card.style.visibility !== visibility) {
                    card.style.visibility = visibility;
                    card.style.willChange = hidden ? '' : 'transform';
                }
                if (hidden && !selectionChanged) return;
                const stops = [1, .44, .14, 0];
                const lower = Math.min(2, Math.floor(distance));
                const mix = Math.min(1, distance - lower);
                const brightness = stops[lower] + (stops[lower + 1] - stops[lower]) * mix;
                shades.get(card).style.opacity = (1 - Math.max(0, brightness)).toFixed(3);
                // The outgoing card recedes early. The incoming card grows as it
                // approaches its anchor, before taking the foreground at rest.
                const isOutgoing = index === layerAnchor && distance > 0;
                const scaleDistance = isOutgoing && distance < 1
                    ? 1 - (1 - distance) ** 4
                    : Math.min(2, distance);
                card.style.transform = 'translateZ(0) scale(' + (1 - scaleDistance * .03).toFixed(4) + ')';
                // Unique layers prevent DOM order from lifting the following card
                // while both cards are between their resting positions.
                const frontIndex = layerAnchor;
                const layer = String((cards.length - Math.abs(index - frontIndex)) * 2 +
                    (index <= frontIndex ? 1 : 0));
                if (card.style.zIndex !== layer) card.style.zIndex = layer;
                if (!selectionChanged) return;
                card.classList.toggle('track-active', index === active);
                for (const child of card.children) child.inert = index !== active;
                if (index === active) card.setAttribute('aria-current', 'true');
                else card.removeAttribute('aria-current');
            });
        }
        function queuePaint() { if (!frame) frame = requestAnimationFrame(() => paint()); }
        let glideFrame = 0;
        function scroll(top, smooth = true, velocity = 0) {
            cancelAnimationFrame(glideFrame);
            glideFrame = 0;
            const target = Math.max(0, Math.min(top, root.scrollHeight - root.clientHeight));
            if (!cachedRanges) cachedRanges = cards.map((_, index) => bounds(index));
            const from = root.scrollTop;
            const distance = target - from;
            if (!smooth || reduced() || Math.abs(distance) < 2) {
                if (smooth) layerAnchor = active;
                root.scrollTop = target;
                queuePaint();
                return 0;
            }
            const speed = Math.abs(velocity);
            const duration = speed > .1 ? Math.min(560, Math.max(180, 3 * Math.abs(distance) / speed)) : Math.min(420, Math.max(240, 190 + Math.abs(distance) * .55));
            const initialSlope = Math.max(0, Math.min(3, velocity * duration / distance));
            const started = performance.now();
            function glide(now) {
                const progress = Math.min(1, (now - started) / duration);
                const eased = velocity ? progress ** 2 * (3 - 2 * progress) + initialSlope * progress * (1 - progress) ** 2 : 1 - (1 - progress) ** 3;
                const position = from + distance * eased;
                root.scrollTop = position;
                cancelAnimationFrame(frame);
                if (progress === 1) layerAnchor = active;
                paint(position);
                glideFrame = progress < 1 ? requestAnimationFrame(glide) : 0;
            }
            glideFrame = requestAnimationFrame(glide);
            return duration;
        }
        function choose(index, vibrate = true, velocity = 0) {
            index = Math.max(0, Math.min(cards.length - 1, index));
            if (index < 0) return;
            const direction = index < active ? -1 : 1;
            const changed = index !== active;
            active = index;
            queuePaint();
            const range = bounds(active);
            movingUntil = performance.now() + scroll(direction < 0 ? range.end : range.start, true, velocity);
            if (changed && vibrate && typeof navigator.vibrate === 'function') {
                try { navigator.vibrate(12); } catch (_) { /* Unsupported device policy. */ }
            }
        }
        function nestedScroll(target, delta) {
            // Autocomplete and other small scroll panels retain their own gestures.
            for (let el = target; el && el !== root; el = el.parentElement) {
                if (el.scrollHeight > el.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(el).overflowY)) return true;
            }
            return false;
        }
        function canReadMore(direction, position = root.scrollTop) {
            const range = bounds(active);
            return direction > 0 ? position < range.end - 3 : position > range.start + 3;
        }
        on('wheel', event => {
            if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || nestedScroll(event.target, event.deltaY) || !cards.length) return;
            event.preventDefault();
            const now = performance.now();
            if (now - wheelLast > GESTURE_GAP) { wheelSum = 0; wheelUsed = false; }
            wheelLast = now;
            if (wheelUsed || now < movingUntil) return;
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientHeight : 1);
            if (!delta) return;
            const direction = Math.sign(delta);
            if (canReadMore(direction)) {
                const range = bounds(active);
                scroll(Math.max(range.start, Math.min(range.end, root.scrollTop + delta)), false);
                // Reaching the end of a tall card requires a fresh gesture to leave it.
                if (!canReadMore(direction)) wheelUsed = true;
                return;
            }
            if (Math.sign(wheelSum) !== direction) wheelSum = 0;
            wheelSum += delta;
            if (Math.abs(wheelSum) >= WHEEL_THRESHOLD) {
                wheelUsed = true;
                choose(active + direction);
            }
        }, {passive: false});
        on('touchstart', event => {
            touch = null;
            if (keyboardOpen || event.touches.length !== 1 ||
                event.target.closest('[data-track-drag-handle]') || nestedScroll(event.target, 0) || !cards.length) return;
            cancelAnimationFrame(glideFrame);
            glideFrame = 0;
            movingUntil = 0;
            const p = event.touches[0];
            touch = {x: p.clientX, y: p.clientY, top: root.scrollTop, dy: 0, dragging: false, reading: false, samples: [{dy: 0, time: performance.now()}]};
        }, {passive: true});
        on('touchmove', event => {
            if (!touch || event.touches.length !== 1) { touch = null; return; }
            const p = event.touches[0], dy = touch.y - p.clientY, dx = touch.x - p.clientX;
            if (!touch.dragging && (Math.abs(dy) < 8 || Math.abs(dx) > Math.abs(dy))) return;
            if (!event.cancelable) { touch = null; return; }
            event.preventDefault();
            touch.dragging = true;
            touch.dy = dy;
            const now = performance.now();
            touch.samples.push({dy, time: now});
            while (touch.samples.length > 1 && now - touch.samples[0].time > 100) touch.samples.shift();
            const range = bounds(active);
            touch.reading = canReadMore(Math.sign(dy), touch.top);
            if (touch.reading) {
                scroll(Math.max(range.start, Math.min(range.end, touch.top + dy)), false);
            } else {
                scroll(touch.top + dy, false);
            }
        }, {passive: false});
        function endTouch(cancelled) {
            if (!touch) return;
            const gesture = touch;
            touch = null;
            if (!gesture.dragging) return;
            suppressClickUntil = performance.now() + 400;
            if (gesture.reading) return;
            const first = gesture.samples[0], last = gesture.samples.at(-1);
            const elapsed = last.time - first.time;
            const velocity = elapsed > 0 && performance.now() - last.time < 90
                ? (last.dy - first.dy) / elapsed : 0;
            if (cancelled) { scroll(gesture.top); return; }
            const projected = root.scrollTop + velocity * 150;
            let nearest = active, nearestDistance = Infinity;
            cards.forEach((_, index) => {
                const range = bounds(index);
                const distance = Math.max(range.start - projected, 0, projected - range.end);
                if (distance < nearestDistance) { nearest = index; nearestDistance = distance; }
            });
            choose(nearest, true, velocity);
        }
        on('touchend', () => endTouch(false));
        on('touchcancel', () => endTouch(true));
        on('click', event => {
            if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); return; }
            const card = event.target.closest('[data-exercise-index]');
            if (!card || event.target.closest('input, button, summary, a')) return;
            const index = cards.indexOf(card);
            if (index >= 0 && index !== active) choose(index);
        }, {capture: true});
        on('pointerdown', event => {
            const input = event.target;
            if (!keyboardOpen || event.pointerType !== 'touch' || !event.isPrimary ||
                !input.matches('input[type="number"]') || !cards[active]?.contains(input) ||
                input === document.activeElement) return;

            // Reuse the open keyboard without Safari panning to the next field.
            // The layout handler reveals the field only if it is clipped.
            event.preventDefault();
            input.focus({preventScroll: true});
        });
        on('focusin', event => {
            const index = cards.indexOf(event.target.closest('[data-exercise-index]'));
            if (index >= 0) active = index;
            scheduleLayout();
        });
        on('keydown', event => {
            if (event.target !== root || !['ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(event.key)) return;
            event.preventDefault();
            choose(event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : active + (/Down/.test(event.key) ? 1 : -1));
        });
        const observer = new ResizeObserver(scheduleLayout);
        function layout() {
            cachedRanges = null;
            paintedPosition = undefined;
            if (!root.isConnected || !cards.length) return;
            root.style.paddingTop = topInset(cards[0]) + 'px';
            root.style.paddingBottom = topInset(cards[cards.length - 1]) + 'px';
            if (document.body.classList.contains('track-keyboard')) {
                const input = document.activeElement;
                const card = cards[active];
                if (card && root.contains(card)) {
                    if (!card.contains(input)) return;
                    const field = input.getBoundingClientRect(), area = root.getBoundingClientRect();
                    if (field.top < area.top + 12) scroll(root.scrollTop + field.top - area.top - 12, false);
                    else if (field.bottom > area.bottom - 12) scroll(root.scrollTop + field.bottom - area.bottom + 12, false);
                }
            }
            queuePaint();
        }
        function update() {
            const next = [...root.querySelectorAll(':scope > [data-exercise-index]')];
            if (next.length === cards.length && next.every((card, i) => card === cards[i])) return;
            const old = cards[active];
            cards = next;
            layerAnchor = Math.max(0, Math.min(layerAnchor, cards.length - 1));
            for (const card of cards) {
                if (shades.has(card)) continue;
                const shade = document.createElement('div');
                shade.className = 'track-card-shade';
                shade.setAttribute('aria-hidden', 'true');
                card.appendChild(shade);
                shades.set(card, shade);
            }
            cachedRanges = null;
            active = Math.max(0, Math.min(cards.length - 1, cards.includes(old) ? cards.indexOf(old) : active));
            observer.disconnect();
            observer.observe(root);
            cards.forEach(card => observer.observe(card));
            scheduleLayout();
        }
        document.body.classList.add('track-layout');
        const viewport = window.visualViewport;
        const mobile = matchMedia('(max-width: 639px)');
        let restingHeight = viewport?.height || innerHeight;
        let viewportWidth = innerWidth;
        let keyboardOpen = false;
        let previousHeight = restingHeight;
        let layoutFrame = 0;
        function scheduleLayout() {
            if (!layoutFrame) layoutFrame = requestAnimationFrame(() => {
                layoutFrame = 0;
                if (!root.isConnected) return;
                const input = document.activeElement;
                const editing = root.contains(input) && input.matches('input, textarea');
                const height = viewport?.height || innerHeight;
                if (viewportWidth !== innerWidth || (!editing && !keyboardOpen)) {
                    viewportWidth = innerWidth;
                    restingHeight = height;
                }
                // A move between fields resolves before this frame. A real blur can
                // restore Track immediately, without waiting for the keyboard animation.
                const lostHeight = restingHeight - height;
                // Use the direction of the viewport animation to enter early
                // and exit early without switching modes repeatedly in between.
                const nextOpen = mobile.matches && editing && (keyboardOpen
                    ? !(height > previousHeight && lostHeight <= 130)
                    : height < previousHeight && lostHeight > 55);
                previousHeight = height;
                if (nextOpen !== keyboardOpen) {
                    keyboardOpen = nextOpen;
                    touch = null;
                    movingUntil = 0;
                }
                document.body.classList.toggle('track-keyboard', keyboardOpen);
                if (keyboardOpen) {
                    document.body.style.setProperty('--track-height', height + 'px');
                    document.body.style.setProperty('--keyboard-top', (viewport?.offsetTop || 0) + 'px');
                } else {
                    document.body.style.removeProperty('--track-height');
                    document.body.style.removeProperty('--keyboard-top');
                }
                layout();
            });
        }
        on('focusout', scheduleLayout);
        viewport?.addEventListener('scroll', scheduleLayout, {signal: controller.signal});
        viewport?.addEventListener('resize', scheduleLayout, {signal: controller.signal});
        window.addEventListener('resize', scheduleLayout, {signal: controller.signal});
        root.classList.add('track-deck', 'overflow-y-auto');
        root.tabIndex = 0;
        root.setAttribute('aria-label', 'Bài tập: vuốt đủ xa hoặc cuộn để chuyển từng bài');
        update();
        return {update, destroy() { controller.abort(); observer.disconnect(); cancelAnimationFrame(frame); cancelAnimationFrame(layoutFrame); cancelAnimationFrame(glideFrame); document.body.classList.remove('track-layout', 'track-keyboard'); document.body.style.removeProperty('--keyboard-top'); document.body.style.removeProperty('--track-height'); }};
    }
    function init() {
        const next = document.getElementById('memberExercisesContainer');
        if (next !== deck) {
            cleanup?.();
            deck = next;
            refresh = cleanup = null;
            if (deck) {
                const mounted = mount(deck);
                refresh = mounted.update;
                cleanup = mounted.destroy;
            }
        } else refresh?.();
    }
    let queued = false;
    new MutationObserver(() => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => { queued = false; init(); });
    }).observe(document.body, {childList: true, subtree: true});
    init();
})();
