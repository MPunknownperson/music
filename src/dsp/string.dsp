import("stdfaust.lib");

// ---------------------------------------------------------------------------
// Plucked string physical model (dispersive digital waveguide).
// Compiled to WebAssembly by Faust and run inside an AudioWorklet.
// One instance = one vibrating string; the JS layer allocates a voice per note.
// ---------------------------------------------------------------------------

freq       = hslider("freq", 220, 20, 2000, 0.01);
gain       = hslider("gain", 0.7, 0, 1, 0.001);
gate       = button("gate");
brightness = hslider("brightness", 0.5, 0, 1, 0.001);
damping    = hslider("damping", 0.35, 0, 1, 0.001);
pluckPos   = hslider("pluckPos", 0.18, 0.02, 0.5, 0.001);
stiffness  = hslider("stiffness", 0.25, 0, 1, 0.001);
bodyMix    = hslider("bodyMix", 0.55, 0, 1, 0.001);

maxDel = 4096;
period = ma.SR / max(freq, 20);
// compensate the phase delay of the loop filters so the pitch stays true
delayLen = max(2, period - 4.6 - 3.0 * stiffness);

// --- excitation: a short filtered noise burst, combed by the plucking point
trig  = gate : ba.impulsify;
burst = no.noise * (trig : en.ar(0.0006, 0.0045)) * gain;
combed = burst - de.fdelay(maxDel, pluckPos * period, burst);
exc = combed : fi.highpass(1, 45) : fi.lowpass(1, 900 + brightness * 9000);

// --- loop: loss filter + stiffness dispersion (cascade of first-order allpass)
damp = 1 - gate : si.smoo;
t60 = max(0.02, 3.4 * pow(220 / max(freq, 20), 0.42) * (1 - 0.7 * damping) * (1 - 0.93 * damp));
fb = pow(0.001, 1 / (t60 * max(freq, 20)));
loopCut = min(ma.SR * 0.45, 1100 + brightness * 7500);
ap = fi.tf2(0.05 + stiffness * 0.2, 1, 0, 0.05 + stiffness * 0.2, 0);
dispersion = seq(i, 4, ap);
string(x) = x : (+ ~ (de.fdelay(maxDel, delayLen) : fi.lowpass(1, loopCut) : dispersion : *(fb)));

// --- body: modal resonances of a wooden soundboard
res(f, q, g) = fi.resonbp(f, q, g);
body(x) = x * (1 - bodyMix) + bodyMix * (
      res(97, 9, 1.0, x)
    + res(196, 11, 0.7, x)
    + res(285, 13, 0.5, x)
    + res(410, 15, 0.35, x)
    + res(620, 17, 0.22, x)
    + res(1050, 19, 0.12, x));

process = exc : string : body : fi.dcblocker : fi.lowpass(2, 7500) : *(0.85);
