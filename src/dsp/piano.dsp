import("stdfaust.lib");

// ---------------------------------------------------------------------------
// Grand piano — hammer / three-string unison / bridge coupling / soundboard.
//
// Each note drives three slightly detuned strings through a nonlinear felt
// hammer. The strings are coupled at the bridge, which is what produces the
// piano's characteristic two-stage decay (a fast prompt sound followed by a
// long, beating aftersound). Stiffness dispersion gives the partials their
// inharmonicity, and a modal soundboard radiates the result.
// ---------------------------------------------------------------------------

freq    = hslider("freq", 220, 20, 5000, 0.01);
gain    = hslider("gain", 0.7, 0, 1, 0.001);
gate    = button("gate");
hammer  = hslider("hammer", 0.5, 0, 1, 0.001);
detune  = hslider("detune", 0.7, 0, 4, 0.001);
inhar   = hslider("inharmonicity", 0.35, 0, 1, 0.001);
decay   = hslider("decay", 0.5, 0, 1, 0.001);
couple  = hslider("coupling", 0.3, 0, 1, 0.001);
board   = hslider("board", 0.5, 0, 1, 0.001);
lid     = hslider("lid", 0.75, 0, 1, 0.001);
damper  = hslider("damper", 0.6, 0, 1, 0.001);
// loop-delay compensation, calibrated per note so the model stays in tune
tuneComp = hslider("tuneComp", 5, 0, 14, 0.001);
knoise  = hslider("releaseNoise", 0.35, 0, 1, 0.001);

maxD = 4096;
f0 = max(freq, 20);
period = ma.SR / f0;
// bass strings are relatively stiffer and longer-lived than treble ones
low = 1 - min(f0 / 600, 1);

// ---- hammer: contact time shortens as the felt is driven harder ------------
vel = gain;
hard = min(1, max(0, hammer * 0.65 + vel * 0.45));
contact = (0.0060 - 0.0046 * hard) * (1 + 0.8 * low);
trig = gate : ba.impulsify;
henv = trig : en.ar(contact * 0.42, contact * 0.58);
excRaw = (1 + no.noise * 0.22) * henv * vel;
excF = excRaw : fi.lowpass(2, min(ma.SR * 0.45, max(f0 * 1.8, 420 + 9500 * hard)));
// the hammer strikes about an eighth of the way along the string
exc = excF - de.fdelay(maxD, 0.125 * period, excF);

// ---- three strings --------------------------------------------------------
spread(i) = (i - 1) * detune;
rate(i) = pow(2, spread(i) / 1200);
Nd(i) = max(2, period / rate(i) - tuneComp - 1.2 * inhar);

// natural sustain: seconds to -60 dB, longer in the bass
t60open(i) = (1.4 + 26 * decay * pow(220 / f0, 0.55)) * (1 - 0.16 * (i - 1));
damp = (1 - gate) : si.smoo;
dampT = 0.05 + 0.30 * (1 - damper) + 0.30 * low * (1 - damper);
t60(i) = 1 / (1 / t60open(i) + damp / dampT);
fb(i) = pow(0.001, 1 / (t60(i) * f0 * rate(i)));

// the loop filter must stay well above the fundamental or the top octaves
// lose their pitch entirely; voicing therefore acts on the partials, not f0
loopCut = min(ma.SR * 0.45, max(f0 * 5, 1400 + 8000 * hard));
apc = 0.015 + 0.10 * inhar * (1 + 0.6 * low);
disp = seq(k, 3, fi.tf2(apc, 1, 0, apc, 0));
line(i) = de.fdelay(maxD, Nd(i)) : fi.lowpass(1, loopCut) : disp : *(fb(i));

// bridge coupling: energy leaks between unison strings (rows sum to 1)
c = couple * 0.5;
bridge(a, b, d) = (a * (1 - 2 * c) + (b + d) * c),
                  (b * (1 - 2 * c) + (a + d) * c),
                  (d * (1 - 2 * c) + (a + b) * c);

loopBank = (line(0), line(1), line(2)) : bridge;
bank(x) = (x, x * 0.97, x * 0.94) : (par(i, 3, +) ~ loopBank);
strings(x) = bank(x) : (_ + _ + _) / 3;

// ---- soundboard: spruce plate modes --------------------------------------
res(f, q, g, x) = fi.resonbp(f, q, g, x);
// the top strings couple far less to the plate than the bass bridge does
bmix = board * (1 - 0.65 * min(f0 / 1800, 1));
plate(x) = x * (1 - bmix) + bmix * (
      res(62, 7, 0.55, x)
    + res(112, 9, 0.42, x)
    + res(196, 11, 0.30, x)
    + res(330, 13, 0.20, x)
    + res(560, 15, 0.13, x)
    + res(980, 17, 0.07, x));

// ---- lid, radiation and damper noise -------------------------------------
tone = fi.lowpass(2, 900 + 13000 * lid);
offTrig = (1 - gate) : ba.impulsify;
koff = no.noise * (offTrig : en.ar(0.0008, 0.016)) * 0.06 * knoise * (0.4 + 0.6 * lid);

process = exc : strings : plate : tone : fi.dcblocker : fi.highpass(1, 24) : (_ + koff) : *(0.6);
