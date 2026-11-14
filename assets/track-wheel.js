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
        let editingScroll = null, restingScroll = null;
        let centerShift = 0;
        const centeredInset = card => (root.clientHeight - card.offsetHeight) / 2;
        const topInset = card => Math.max(16, centeredInset(card) + centerShift);
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
            if (keyboardOpen) visualIndex = active;
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
        let edgeOffset = 0;
        function setEdgeOffset(offset) {
            edgeOffset = offset;
            if (offset) root.style.setProperty('--track-edge-offset', offset + 'px');
            else root.style.removeProperty('--track-edge-offset');
        }
        function scroll(top, smooth = true, velocity = 0) {
            cancelAnimationFrame(glideFrame);
            glideFrame = 0;
            const target = Math.max(0, Math.min(top, root.scrollHeight - root.clientHeight));
            if (!cachedRanges) cachedRanges = cards.map((_, index) => bounds(index));
            const from = root.scrollTop;
            const initialOffset = edgeOffset;
            const distance = target - from;
            if (!smooth || reduced() || (Math.abs(distance) < 2 && !initialOffset)) {
                if (smooth) {
                    layerAnchor = active;
                    setEdgeOffset(0);
                }
                root.scrollTop = target;
                queuePaint();
                return 0;
            }
            const speed = Math.abs(velocity);
            const duration = speed > .1 ? Math.min(560, Math.max(180, 3 * Math.abs(distance) / speed)) : Math.min(420, Math.max(240, 190 + Math.abs(distance) * .55));
            const initialSlope = Math.max(0, Math.min(3, distance ? velocity * duration / distance : 0));
            const started = performance.now();
            function glide(now) {
                const progress = Math.min(1, (now - started) / duration);
                const eased = velocity ? progress ** 2 * (3 - 2 * progress) + initialSlope * progress * (1 - progress) ** 2 : 1 - (1 - progress) ** 3;
                const position = from + distance * eased;
                root.scrollTop = position;
                if (initialOffset) setEdgeOffset(initialOffset * (1 - progress) ** 3);
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
                event.target.closest('[data-track-drag-handle], [id^="pred_dropdown_"], [data-transfer-options]') || nestedScroll(event.target, 0) || !cards.length) return;
            const p = event.touches[0];
            touch = {
                x: p.clientX, y: p.clientY, top: root.scrollTop,
                startedDuringGlide: glideFrame !== 0, dragging: false,
                samples: [{dy: 0, time: performance.now()}]
            };
        }, {passive: true});
        on('touchmove', event => {
            if (!touch || event.touches.length !== 1) { touch = null; return; }
            const p = event.touches[0], dy = touch.y - p.clientY, dx = touch.x - p.clientX;
            if (!touch.dragging && (Math.abs(dy) < 8 || Math.abs(dx) > Math.abs(dy))) return;
            if (!event.cancelable) { touch = null; return; }
            event.preventDefault();
            if (!touch.dragging && touch.startedDuringGlide) {
                // Pick up from the current frame without replaying the dead zone.
                const stretch = Math.min(71.99, Math.abs(edgeOffset));
                const overshoot = Math.sign(edgeOffset) * 144 * stretch / (72 - stretch);
                touch.top = root.scrollTop - dy - overshoot;
            }
            touch.dragging = true;
            movingUntil = 0;
            const now = performance.now();
            touch.samples.push({dy, time: now});
            while (touch.samples.length > 1 && now - touch.samples[0].time > 100) touch.samples.shift();
            const requested = touch.top + dy;
            scroll(requested, false);
            const limit = Math.max(0, root.scrollHeight - root.clientHeight);
            const excess = requested - Math.max(0, Math.min(limit, requested));
            setEdgeOffset(reduced() ? 0 : -72 * excess / (144 + Math.abs(excess)));
        }, {passive: false});
        function endTouch(event, cancelled) {
            if (!touch) return;
            const gesture = touch;
            touch = null;
            if (!gesture.dragging) {
                if (gesture.startedDuringGlide || glideFrame) {
                    if (event.cancelable) event.preventDefault();
                    suppressClickUntil = performance.now() + 400;
                }
                return;
            }
            suppressClickUntil = performance.now() + 400;
            const first = gesture.samples[0], last = gesture.samples.at(-1);
            const elapsed = last.time - first.time;
            const velocity = elapsed > 0 && performance.now() - last.time < 90
                ? (last.dy - first.dy) / elapsed : 0;
            if (cancelled) {
                const range = bounds(active);
                scroll(Math.max(range.start, Math.min(range.end, root.scrollTop)));
                return;
            }
            const projected = root.scrollTop + (reduced() ? 0 : velocity * 180);
            let nearest = active, nearestDistance = Infinity;
            cards.forEach((_, index) => {
                const range = bounds(index);
                const distance = Math.max(range.start - projected, 0, projected - range.end);
                if (distance < nearestDistance) { nearest = index; nearestDistance = distance; }
            });
            if (nearest === active) {
                const range = bounds(active);
                scroll(Math.max(range.start, Math.min(range.end, projected)), true, velocity);
            } else {
                choose(nearest, true, velocity);
            }
        }
        on('touchend', event => endTouch(event, false), {passive: false});
        on('touchcancel', event => endTouch(event, true));
        on('click', event => {
            if (event.target.closest('[id^="pred_dropdown_"], [data-transfer-options]')) return;
            if (glideFrame || performance.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); return; }
            const card = event.target.closest('[data-exercise-index]');
            if (!card || event.target.closest('input, button, summary, a')) return;
            const index = cards.indexOf(card);
            if (index >= 0 && index !== active) {
                choose(index);
            } else if (index >= 0) {
                const cell = event.target.closest('[data-set-input-hit-area]');
                cell?.querySelector('input')?.focus({preventScroll: true});
            }
        }, {capture: true});
        let noteTap = null;
        on('pointerdown', event => {
            const input = event.target;
            if (event.pointerType !== 'touch' || !event.isPrimary ||
                !cards[active]?.contains(input) || input === document.activeElement) return;

            if (glideFrame) {
                event.preventDefault();
                return;
            }
            if (input.matches('textarea')) {
                event.preventDefault();
                noteTap = { input, id: event.pointerId, x: event.clientX, y: event.clientY };
                return;
            }
            if (!keyboardOpen || !input.matches('input[type="number"]')) return;
            event.preventDefault();
            input.focus({preventScroll: true});
        });
        function noteTapMoved(event) {
            return Math.hypot(event.clientX - noteTap.x, event.clientY - noteTap.y) >= 8;
        }
        on('pointermove', event => {
            if (noteTap?.id === event.pointerId && noteTapMoved(event)) noteTap = null;
        });
        on('pointercancel', event => {
            if (noteTap?.id === event.pointerId) noteTap = null;
        });
        on('pointerup', event => {
            if (noteTap?.id !== event.pointerId) return;
            const { input } = noteTap;
            const isTap = !noteTapMoved(event);
            noteTap = null;
            if (isTap && cards[active]?.contains(input)) input.focus({preventScroll: true});
        });
        on('track:after-delete', event => {
            update();
            if (Number.isInteger(event.detail?.focusIndex)) {
                active = layerAnchor = event.detail.focusIndex;
            }
            layout();
            if (!keyboardOpen && cards.length) {
                const range = bounds(active);
                layerAnchor = active;
                scroll(Math.max(range.start, Math.min(range.end, root.scrollTop)), false);
            }
            // Apply the dimming before the delete animation measures the new cards.
            cancelAnimationFrame(frame);
            paint();
        });
        on('pointerdown', event => {
            if (keyboardOpen) return;
            openingOrigin = null;
            const field = event.target.closest('input, textarea, [data-set-input-hit-area]');
            const card = field?.closest('[data-exercise-index]');
            if (card && cards[active] === card) {
                openingOrigin = { card, top: card.getBoundingClientRect().top - (viewport?.offsetTop || 0) };
            }
        }, {capture: true});
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
            if (keyboardOpen) {
                const card = cards[active];
                const available = root.clientHeight;
                const margin = 8;
                // Give the first and last card room to center even at the scroll limits.
                const padding = Math.ceil(available / 2);
                root.style.paddingTop = padding + 'px';
                root.style.paddingBottom = padding + 'px';
                let target = card.offsetTop - Math.max(margin, (available - card.offsetHeight) / 2);
                const field = document.activeElement;
                if (card.offsetHeight > available - 2 * margin && card.contains(field)) {
                    const fieldRect = field.getBoundingClientRect();
                    const fieldTop = card.offsetTop + fieldRect.top - card.getBoundingClientRect().top;
                    target = Math.min(target, fieldTop - margin);
                    target = Math.max(target, fieldTop + fieldRect.height + margin - available);
                }
                root.scrollTop = Math.max(0, target);
                editingScroll = root.scrollTop;
            } else {
                const rect = root.getBoundingClientRect();
                const screenCenter = (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) / 2;
                const deckCenter = rect.top + rect.height / 2;
                centerShift = Math.max(-12, Math.min(12, screenCenter - deckCenter));
                root.style.paddingTop = topInset(cards[0]) + 'px';
                root.style.paddingBottom = Math.max(16, centeredInset(cards[cards.length - 1]) - centerShift) + 'px';
                if (restingScroll !== null) {
                    root.scrollTop = restingScroll;
                    restingScroll = null;
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
        let keyboardSlide;
        let openingOrigin;
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
                // A keyboard type change can briefly grow the viewport.
                // Keep the editing session until it is almost fully restored.
                const nextOpen = mobile.matches && editing && lostHeight > (keyboardOpen ? 24 : 55);
                const slidingCard = nextOpen !== keyboardOpen && !reduced() ? cards[active] : null;
                const viewportTop = viewport?.offsetTop || 0;
                const previousTop = nextOpen && openingOrigin && openingOrigin.card === slidingCard
                    ? openingOrigin.top
                    : slidingCard?.getBoundingClientRect().top - viewportTop;
                if (nextOpen || !editing) openingOrigin = null;
                if (nextOpen !== keyboardOpen) {
                    keyboardSlide?.cancel();
                    keyboardSlide = null;
                    if (nextOpen) restingScroll = root.scrollTop;
                    editingScroll = null;
                    cancelAnimationFrame(glideFrame);
                    glideFrame = 0;
                    setEdgeOffset(0);
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
                if (slidingCard) {
                    // Apply the new layout immediately and animate the selected card from its previous position.
                    const offset = previousTop - (slidingCard.getBoundingClientRect().top - viewportTop);
                    if (Math.abs(offset) > 1) {
                        keyboardSlide = slidingCard.animate(
                            [{translate: '0 ' + offset + 'px'}, {translate: '0 0px'}],
                            {duration: nextOpen ? 260 : 200, easing: 'cubic-bezier(0.25, 0.65, 0.35, 1)'}
                        );
                    }
                }
            });
        }
        on('scroll', () => {
            if (keyboardOpen && editingScroll !== null && Math.abs(root.scrollTop - editingScroll) > 1) {
                root.scrollTop = editingScroll;
            }
        });
        on('focusout', scheduleLayout);
        viewport?.addEventListener('scroll', scheduleLayout, {signal: controller.signal});
        viewport?.addEventListener('resize', scheduleLayout, {signal: controller.signal});
        window.addEventListener('resize', scheduleLayout, {signal: controller.signal});
        root.classList.add('track-deck', 'overflow-y-auto');
        root.tabIndex = 0;
        root.setAttribute('aria-label', 'Bài tập: vuốt đủ xa hoặc cuộn để chuyển từng bài');
        update();
        layout();
        cancelAnimationFrame(frame);
        paint();
        return {update, destroy() { controller.abort(); observer.disconnect(); keyboardSlide?.cancel(); setEdgeOffset(0); cancelAnimationFrame(frame); cancelAnimationFrame(layoutFrame); cancelAnimationFrame(glideFrame); document.body.classList.remove('track-layout', 'track-keyboard'); document.body.style.removeProperty('--keyboard-top'); document.body.style.removeProperty('--track-height'); }};
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
