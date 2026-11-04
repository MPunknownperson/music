import("stdfaust.lib");

// ---------------------------------------------------------------------------
// Acoustic space / soundboard resonator (stereo effect).
// Feedback delay network with lossy combs + allpass diffusion, plus a small
// modal bank that gives the wooden "inside the instrument" colouration.
// ---------------------------------------------------------------------------

size  = hslider("size", 0.5, 0, 1, 0.001);
decay = hslider("decay", 0.55, 0, 1, 0.001);
mix   = hslider("mix", 0.3, 0, 1, 0.001);
tone  = hslider("tone", 0.5, 0, 1, 0.001);
width = hslider("width", 0.7, 0, 1, 0.001);

maxD = 8192;
cut = 900 + tone * 7000;
g = 0.62 + decay * 0.35;
scale = 0.55 + size * 1.6;

comb(d, x) = x : (+ ~ (de.delay(maxD, int(d * scale)) : fi.lowpass(1, cut) : *(g)));
ap(d, x) = x : fi.tf2(-0.6, 1, 0, -0.6, 0) : de.delay(maxD, int(d * scale));

left(x)  = (comb(1187, x) + comb(1523, x) * 0.8 + comb(1801, x) * 0.6) : ap(233) : ap(97);
right(x) = (comb(1237, x) + comb(1571, x) * 0.8 + comb(1747, x) * 0.6) : ap(211) : ap(113);

res(f, q, gg, x) = fi.resonbp(f, q, gg, x);
wood(x) = 0.7 * x + 0.3 * (res(148, 8, 0.5, x) + res(322, 11, 0.35, x) + res(720, 14, 0.2, x));

wetL(l, r) = wood(left(l * 0.6 + r * 0.4)) * 0.28;
wetR(l, r) = wood(right(r * 0.6 + l * 0.4)) * 0.28;

process(l, r) = (l * (1 - mix) + (wetL(l, r) * (1 - width) + wetR(l, r) * width) * mix),
                (r * (1 - mix) + (wetR(l, r) * (1 - width) + wetL(l, r) * width) * mix)
                : fi.dcblocker, fi.dcblocker;
