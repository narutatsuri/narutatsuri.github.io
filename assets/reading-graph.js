/* The reading graph on the Misc. page — a port of Paper Notes' graph window.
 *
 * Data comes from data/reading-graph-data.js, written by the app's
 * `--export-graph`. The physics is a line-for-line port of the app's GraphSim
 * (same constants, same clamps, same soft containment), drawn on a canvas over
 * the app's dark surface. Drag to pan, scroll to zoom, drag a paper and its
 * neighbours follow, double-click to reset. Hover shows the paper's summary;
 * a hollow circle is a paper whose summary was never written.
 *
 * The pure parts (node styling, tooltip text, the simulation factory) are
 * exported for Node so they can be tested without a browser.
 */
(function () {
    "use strict";

    var SURFACE = "#17181c";
    var K = 105, ALPHA_DECAY = 0.015, ALPHA_MIN = 0.0025, DAMPING = 0.72;

    // Hollow means the claim was never written: on the shelf, not yet in the notes.
    function nodeStyle(node) {
        var hollow = !node.summary;
        return { hollow: hollow, fill: hollow ? SURFACE : node.fill, stroke: node.fill };
    }

    function tooltip(node) {
        return {
            head: node.label ? node.title + " — " + node.label : node.title,
            body: node.summary || "No summary written up yet.",
            hint: node.url ? "Click to open the paper." : "",
        };
    }

    // The app draws radius 7–26 and gives each body mass radius/8; the export
    // carries r on a 5–16 scale, so both are recovered from it.
    function appRadius(node) { return 7 + ((node.r - 5) / 11) * 19; }
    function mass(node) { return Math.max(1, appRadius(node) / 8); }

    /* A port of GraphSim.step, body for body. Bodies carry velocity and mass;
     * alpha cools d3-style and interaction reheats it. */
    function createSim(data, width, height) {
        var sx = width / data.width, sy = height / data.height;
        var cx = width / 2, cy = height / 2;
        var boundsRadius = Math.min(width, height) * 0.62;
        var bodies = data.nodes.map(function (n) {
            return { x: n.x * sx, y: n.y * sy, vx: 0, vy: 0, m: mass(n) };
        });
        var alpha = 1.0;
        var dragging = -1, dragX = 0, dragY = 0;

        function step() {
            var n = bodies.length;
            if (!n) return;
            if (alpha > ALPHA_MIN) {
                alpha -= (alpha - ALPHA_MIN) * ALPHA_DECAY;
                if (alpha - ALPHA_MIN < 1e-4) alpha = ALPHA_MIN;
            }
            var fx = new Array(n).fill(0), fy = new Array(n).fill(0);
            var i, j;
            for (i = 0; i < n; i++) {
                var bi = bodies[i];
                for (j = 0; j < n; j++) {
                    if (i === j) continue;
                    var bj = bodies[j];
                    var vx = bi.x - bj.x, vy = bi.y - bj.y;
                    var d2 = vx * vx + vy * vy;
                    if (d2 < 0.5) {
                        // Deterministic nudge, as in the app.
                        vx = (i % 17) - 8; vy = (i % 13) - 6;
                        d2 = Math.max(0.5, vx * vx + vy * vy);
                    }
                    var d = Math.sqrt(d2);
                    var rep = (K * K) * bj.m / d2;   // big papers push harder
                    fx[i] += (vx / d) * rep;
                    fy[i] += (vy / d) * rep;
                }
                fx[i] += (cx - bi.x) * 0.9;         // gentle pull to centre
                fy[i] += (cy - bi.y) * 0.9;
            }
            for (i = 0; i < data.edges.length; i++) {
                var e = data.edges[i];
                var a = bodies[e[0]], b = bodies[e[1]], w = e[2];
                var evx = a.x - b.x, evy = a.y - b.y;
                var ed = Math.max(1, Math.hypot(evx, evy));
                // Rest length shortens as the relation strengthens, so
                // distance carries meaning.
                var rest = K * (1.65 - Math.min(1, w));
                var stretch = Math.min(900, Math.max(-900, ed - rest)) * (0.5 + w * 0.6);
                var sfx = (evx / ed) * stretch, sfy = (evy / ed) * stretch;
                fx[e[0]] -= sfx; fy[e[0]] -= sfy;
                fx[e[1]] += sfx; fy[e[1]] += sfy;
            }
            for (i = 0; i < n; i++) {
                var body = bodies[i];
                if (i === dragging) {
                    // Held node follows the cursor; velocity records the
                    // motion (capped) so releasing it throws the node.
                    var dx = dragX - body.x, dy = dragY - body.y;
                    var dvx = dx * 0.5, dvy = dy * 0.5;
                    var dsp = Math.hypot(dvx, dvy);
                    if (dsp > 14) { dvx *= 14 / dsp; dvy *= 14 / dsp; }
                    body.vx = dvx; body.vy = dvy;
                    body.x = dragX; body.y = dragY;
                    continue;
                }
                var s = alpha / body.m;
                body.vx = (body.vx + fx[i] * s * 0.0016) * DAMPING;
                body.vy = (body.vy + fy[i] * s * 0.0016) * DAMPING;
                var speed = Math.hypot(body.vx, body.vy);
                if (speed > 26) { body.vx *= 26 / speed; body.vy *= 26 / speed; }
                body.x += body.vx;
                body.y += body.vy;
                // Soft containment as a positional correction — the app
                // learned the hard way that a force scaled by alpha cannot
                // bring a flung graph back.
                var ox = body.x - cx, oy = body.y - cy;
                var dist = Math.hypot(ox, oy);
                if (dist > boundsRadius) {
                    var corr = (dist - boundsRadius) * 0.08;
                    body.x -= (ox / dist) * corr;
                    body.y -= (oy / dist) * corr;
                    var outward = (body.vx * ox + body.vy * oy) / dist;
                    if (outward > 0) {
                        body.vx -= (ox / dist) * outward;
                        body.vy -= (oy / dist) * outward;
                    }
                }
                if (!isFinite(body.x) || !isFinite(body.y)) {
                    body.x = cx; body.y = cy; body.vx = 0; body.vy = 0;
                }
            }
        }

        return {
            bodies: bodies,
            centre: function () { return [cx, cy]; },
            step: step,
            alpha: function () { return alpha; },
            settled: function () { return alpha <= ALPHA_MIN && dragging < 0; },
            reheat: function (to) { alpha = Math.max(alpha, to || 0.55); },
            drag: function (index, x, y) {
                dragging = index;
                if (index >= 0) { dragX = x; dragY = y; this.reheat(0.55); }
            },
        };
    }

    function render(data, mount) {
        var width = Math.max(320, mount.clientWidth || 700);
        var height = 520;
        var dpr = window.devicePixelRatio || 1;
        var canvas = document.createElement("canvas");
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.height = height + "px";
        var ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        mount.appendChild(canvas);

        var tip = document.createElement("div");
        tip.className = "reading-graph-tip";
        var tipHead = document.createElement("div"); tipHead.className = "tip-head";
        var tipBody = document.createElement("div"); tipBody.className = "tip-body";
        var tipHint = document.createElement("div"); tipHint.className = "tip-hint";
        tip.appendChild(tipHead); tip.appendChild(tipBody); tip.appendChild(tipHint);
        mount.appendChild(tip);

        var sim = createSim(data, width, height);
        var cx = width / 2, cy = height / 2;
        var scale = 1, panX = 0, panY = 0;
        var focus = -1, dragIndex = -1, panning = false;
        var downX = 0, downY = 0, lastX = 0, lastY = 0, moved = 0;
        var pinchDist = 0;

        var radii = data.nodes.map(appRadius);
        var neighbours = data.nodes.map(function () { return {}; });
        data.edges.forEach(function (e) {
            neighbours[e[0]][e[1]] = true;
            neighbours[e[1]][e[0]] = true;
        });
        // Labels are claimed by citation order (r encodes citations), the
        // focused node first — the papers that anchor the field keep theirs.
        var labelOrder = data.nodes.map(function (_, i) { return i; })
            .sort(function (a, b) { return radii[b] - radii[a]; });

        function toWorld(x, y) {
            return [(x - panX - cx) / scale + cx, (y - panY - cy) / scale + cy];
        }

        function nodeAt(wx, wy) {
            var best = -1, bestD = Infinity;
            for (var i = 0; i < sim.bodies.length; i++) {
                var b = sim.bodies[i];
                var d = Math.hypot(b.x - wx, b.y - wy);
                if (d < radii[i] + 4 / scale && d < bestD) { best = i; bestD = d; }
            }
            return best;
        }

        function draw() {
            ctx.fillStyle = SURFACE;
            ctx.fillRect(0, 0, width, height);
            ctx.save();
            ctx.translate(cx + panX, cy + panY);
            ctx.scale(scale, scale);
            ctx.translate(-cx, -cy);

            var i, e, a, b;
            for (i = 0; i < data.edges.length; i++) {
                e = data.edges[i];
                a = sim.bodies[e[0]]; b = sim.bodies[e[1]];
                var touched = focus >= 0 && (e[0] === focus || e[1] === focus);
                var dimmed = focus >= 0 && !touched;
                ctx.strokeStyle = "rgba(200, 206, 218, "
                    + (dimmed ? 0.07 : 0.16 + e[2] * 0.34) + ")";
                ctx.lineWidth = (touched ? 2.2 : 1.2) / scale;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            }

            for (i = 0; i < data.nodes.length; i++) {
                var node = data.nodes[i], body = sim.bodies[i], r = radii[i];
                var isFocus = i === focus;
                var dim = focus >= 0 && !isFocus && !neighbours[focus][i];
                var style = nodeStyle(node);

                ctx.globalAlpha = 1;
                ctx.fillStyle = SURFACE;                     // halo
                ctx.beginPath();
                ctx.arc(body.x, body.y, r + 2, 0, 2 * Math.PI);
                ctx.fill();

                ctx.globalAlpha = dim ? 0.22 : 1;
                ctx.beginPath();
                ctx.arc(body.x, body.y, r, 0, 2 * Math.PI);
                if (style.hollow) {
                    ctx.strokeStyle = style.stroke;
                    ctx.lineWidth = Math.max(1.4, r * 0.18);
                    ctx.stroke();
                } else {
                    ctx.fillStyle = style.fill;
                    ctx.fill();
                }
                ctx.globalAlpha = 1;

                if (isFocus) {
                    ctx.strokeStyle = "rgba(255,255,255,0.45)";
                    ctx.lineWidth = 1.5 / scale;
                    ctx.beginPath();
                    ctx.arc(body.x, body.y, r + 3.5, 0, 2 * Math.PI);
                    ctx.stroke();
                }
            }

            // Labels last, only where they fit.
            ctx.font = (9.5 / scale) + "px 'Helvetica Neue', Helvetica, Arial, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            var claimed = [];
            var order = focus >= 0
                ? [focus].concat(labelOrder.filter(function (i2) { return i2 !== focus; }))
                : labelOrder;
            for (var oi = 0; oi < order.length; oi++) {
                i = order[oi];
                var pos = sim.bodies[i];
                var text = data.nodes[i].label;
                var w = (text.length * 5.2) / scale, h = 12 / scale;
                var x0 = pos.x - w / 2, y0 = pos.y + radii[i] + 5 / scale;
                var overlaps = claimed.some(function (c) {
                    return x0 < c[0] + c[2] && x0 + w > c[0] && y0 < c[1] + c[3] && y0 + h > c[1];
                });
                if (overlaps) continue;
                claimed.push([x0 - 2 / scale, y0 - 1 / scale, w + 4 / scale, h + 2 / scale]);
                var dim2 = focus >= 0 && i !== focus && !neighbours[focus][i];
                ctx.fillStyle = dim2 ? "rgba(190,196,208,0.28)" : "rgba(205,211,222,0.78)";
                ctx.fillText(text, pos.x, y0);
            }
            ctx.restore();
        }

        function frame() {
            if (!sim.settled()) sim.step();
            draw();
            window.requestAnimationFrame(frame);
        }
        window.requestAnimationFrame(frame);

        function showTip(index, clientX, clientY) {
            var text = tooltip(data.nodes[index]);
            tipHead.textContent = text.head;
            tipBody.textContent = text.body;
            tipHint.textContent = text.hint;
            tip.style.visibility = "visible";
            var bounds = mount.getBoundingClientRect();
            var x = clientX - bounds.left + 14, y = clientY - bounds.top + 14;
            x = Math.min(x, bounds.width - tip.offsetWidth - 6);
            tip.style.left = Math.max(0, x) + "px";
            tip.style.top = Math.min(y, height - 40) + "px";
        }

        canvas.addEventListener("mousedown", function (event) {
            var world = toWorld(event.offsetX, event.offsetY);
            dragIndex = nodeAt(world[0], world[1]);
            panning = dragIndex < 0;
            downX = lastX = event.offsetX; downY = lastY = event.offsetY;
            moved = 0;
            if (dragIndex >= 0) sim.drag(dragIndex, world[0], world[1]);
        });
        canvas.addEventListener("mousemove", function (event) {
            moved += Math.abs(event.offsetX - lastX) + Math.abs(event.offsetY - lastY);
            if (dragIndex >= 0) {
                var world = toWorld(event.offsetX, event.offsetY);
                sim.drag(dragIndex, world[0], world[1]);
                showTip(dragIndex, event.clientX, event.clientY);
            } else if (panning) {
                panX += event.offsetX - lastX;
                panY += event.offsetY - lastY;
                tip.style.visibility = "hidden";
            } else {
                var w2 = toWorld(event.offsetX, event.offsetY);
                focus = nodeAt(w2[0], w2[1]);
                canvas.style.cursor = focus >= 0 ? "pointer" : "default";
                if (focus >= 0) showTip(focus, event.clientX, event.clientY);
                else tip.style.visibility = "hidden";
            }
            lastX = event.offsetX; lastY = event.offsetY;
        });
        window.addEventListener("mouseup", function () {
            if (dragIndex >= 0) {
                // A click, not a drag: open the paper.
                var node = data.nodes[dragIndex];
                if (moved < 4 && node.url) window.open(node.url, "_blank", "noopener");
                sim.drag(-1, 0, 0);
            }
            dragIndex = -1;
            panning = false;
        });
        canvas.addEventListener("mouseleave", function () {
            focus = -1;
            tip.style.visibility = "hidden";
        });
        var hint = document.createElement("div");
        hint.className = "reading-graph-hint";
        hint.textContent = (navigator.platform || "").indexOf("Mac") >= 0
            ? "⌘ + scroll to zoom" : "Ctrl + scroll to zoom";
        mount.appendChild(hint);
        var hintTimer = null;
        function flashHint() {
            hint.classList.add("visible");
            if (hintTimer) clearTimeout(hintTimer);
            hintTimer = setTimeout(function () { hint.classList.remove("visible"); }, 1200);
        }

        canvas.addEventListener("wheel", function (event) {
            // Plain scrolling keeps scrolling the page — a graph that eats
            // the wheel is the embedded-map mistake. Zoom asks for a
            // modifier; a trackpad pinch arrives as ctrl+wheel, so pinching
            // zooms with no modifier at all.
            if (!event.ctrlKey && !event.metaKey) { flashHint(); return; }
            event.preventDefault();
            var factor = Math.exp(-event.deltaY * 0.0015);
            var next = Math.min(4, Math.max(0.25, scale * factor));
            // Zoom about the cursor: the point under it stays put.
            var wx = (event.offsetX - panX - cx) / scale + cx;
            var wy = (event.offsetY - panY - cy) / scale + cy;
            scale = next;
            panX = event.offsetX - cx - (wx - cx) * scale;
            panY = event.offsetY - cy - (wy - cy) * scale;
        }, { passive: false });
        canvas.addEventListener("dblclick", function () {
            scale = 1; panX = 0; panY = 0;
            sim.reheat(0.55);
        });

        // Touch: a finger on a paper drags the paper; a finger on empty space
        // belongs to the page (swiping over the graph must keep scrolling —
        // trapping it is the mobile version of eating the wheel). Two fingers
        // pinch-zoom and pan the graph.
        var lastMidX = 0, lastMidY = 0;
        canvas.addEventListener("touchstart", function (event) {
            var b = canvas.getBoundingClientRect();
            if (event.touches.length === 1) {
                var t = event.touches[0];
                var world = toWorld(t.clientX - b.left, t.clientY - b.top);
                dragIndex = nodeAt(world[0], world[1]);
                if (dragIndex >= 0) sim.drag(dragIndex, world[0], world[1]);
            } else if (event.touches.length === 2) {
                if (dragIndex >= 0) { sim.drag(-1, 0, 0); dragIndex = -1; }
                pinchDist = Math.hypot(
                    event.touches[0].clientX - event.touches[1].clientX,
                    event.touches[0].clientY - event.touches[1].clientY);
                lastMidX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
                lastMidY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
            }
        }, { passive: true });
        canvas.addEventListener("touchmove", function (event) {
            var b = canvas.getBoundingClientRect();
            if (event.touches.length === 1 && dragIndex >= 0) {
                event.preventDefault();
                var t = event.touches[0];
                var world = toWorld(t.clientX - b.left, t.clientY - b.top);
                sim.drag(dragIndex, world[0], world[1]);
            } else if (event.touches.length === 2 && pinchDist > 0) {
                event.preventDefault();
                var d = Math.hypot(
                    event.touches[0].clientX - event.touches[1].clientX,
                    event.touches[0].clientY - event.touches[1].clientY);
                scale = Math.min(4, Math.max(0.25, scale * (d / pinchDist)));
                pinchDist = d;
                var midX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
                var midY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
                panX += midX - lastMidX;
                panY += midY - lastMidY;
                lastMidX = midX; lastMidY = midY;
            }
            // One finger on empty space: no preventDefault — the page scrolls.
        }, { passive: false });
        window.addEventListener("touchend", function () {
            if (dragIndex >= 0) sim.drag(-1, 0, 0);
            dragIndex = -1; panning = false; pinchDist = 0;
        });
    }

    if (typeof module !== "undefined" && module.exports) {
        module.exports = { nodeStyle: nodeStyle, tooltip: tooltip,
                           createSim: createSim, mass: mass, appRadius: appRadius };
    } else if (typeof window !== "undefined") {
        document.addEventListener("DOMContentLoaded", function () {
            var mount = document.getElementById("reading-graph");
            if (mount && window.READING_GRAPH) render(window.READING_GRAPH, mount);
        });
    }
})();
