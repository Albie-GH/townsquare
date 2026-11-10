// Simple noise gate for the voice chat. Runs on the audio thread, so it keeps
// working when the tab is in the background. Anything quieter than "threshold"
// (in dB, -100 = gate always open) is faded out after a short hold.
class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "threshold",
        defaultValue: -100,
        minValue: -100,
        maxValue: 0,
        automationRate: "k-rate"
      }
    ];
  }

  constructor() {
    super();
    this.gain = 1;
    this.open = true;
    this.holdLeft = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;
    const threshold = parameters.threshold[0];
    const n = input[0].length;

    let sum = 0;
    for (let c = 0; c < input.length; c++) {
      for (let i = 0; i < n; i++) sum += input[c][i] * input[c][i];
    }
    const rms = Math.sqrt(sum / (n * input.length));
    const db = rms > 0 ? 20 * Math.log10(rms) : -100;

    if (threshold <= -99 || db >= threshold) {
      this.open = true;
      this.holdLeft = sampleRate * 0.15; // stay open 150ms after the last loud block
    } else if (this.holdLeft > 0) {
      this.holdLeft -= n;
    } else {
      this.open = false;
    }

    const target = this.open ? 1 : 0;
    const seconds = target > this.gain ? 0.005 : 0.06; // fast open, gentle close
    const coef = 1 - Math.exp(-n / (sampleRate * seconds));
    const start = this.gain;
    const end = start + (target - start) * coef;
    for (let c = 0; c < output.length; c++) {
      const inp = input[c] || input[0];
      for (let i = 0; i < n; i++) {
        output[c][i] = inp[i] * (start + ((end - start) * (i + 1)) / n);
      }
    }
    this.gain = end;
    return true;
  }
}

registerProcessor("botc-noise-gate", NoiseGateProcessor);
