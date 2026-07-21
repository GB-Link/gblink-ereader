class _ReedSolomon {
    constructor() {
        this.mm = 8;
        this.nn = 255;
        this.tt = 16;
        this.kk = 239;
        this.pp = 0x187;
        this.b0 = 0x78;
        this.alpha_to = [];
        this.index_of = [];
        this.gg = [];
        this.recd = [];
        this.rs_init = -1;
        this.curr_errlen = 0;
    }
    zerofill(data, len) {
        for (let i = 0; i < len; ++i) {
            data[i] = 0;
        }
    }
    eras_dec_rs(eras_pos, no_eras) {
        const phi = new Array(2 * _ReedSolomon.d_tt + 1);
        const tmp_pol = new Array(2 * _ReedSolomon.d_tt + 1);
        const lambda = new Array(2 * _ReedSolomon.d_tt + 1);
        const s = new Array(2 * _ReedSolomon.d_tt + 1);
        const lambda_pr = new Array(2 * _ReedSolomon.d_tt + 1);
        const b = new Array(2 * _ReedSolomon.d_tt + 1);
        const T = new Array(2 * _ReedSolomon.d_tt + 1);
        const omega = new Array(2 * _ReedSolomon.d_tt + 1);
        let syn_error = 0;
        const root = new Array(2 * _ReedSolomon.d_tt + 1);
        const err = new Array(_ReedSolomon.d_nn);
        const reg = new Array(2 * _ReedSolomon.d_tt + 1);
        const loc = new Array(2 * _ReedSolomon.d_tt + 1);
        let count = 0;
        this.zerofill(tmp_pol, this.nn - this.kk + 1);
        this.zerofill(phi, this.nn - this.kk + 1);
        if (no_eras > 0) {
            phi[0] = 1;
            phi[1] = this.alpha_to[eras_pos[0]];
            for (let i = 1; i < no_eras; i++) {
                const U = eras_pos[i];
                for (let j = 1; j < i + 2; j++) {
                    const tmp1 = this.index_of[phi[j - 1]];
                    tmp_pol[j] = tmp1 == 0xff ? 0 : this.alpha_to[(U + tmp1) % 0xff];
                }
                for (let j = 1; j < i + 2; j++)
                    phi[j] = phi[j] ^ tmp_pol[j];
            }
            this.make_rev(phi, this.nn - this.kk + 1);
        }
        this.make_rev(this.recd, this.nn);
        for (let i = 1; i <= this.nn - this.kk; i++) {
            s[i] = 0;
            for (let j = 0; j < this.nn; j++)
                if (this.recd[j] != 0xff)
                    s[i] ^= this.alpha_to[(this.recd[j] + (this.b0 + i - 1) * j) % 0xff];
            if (s[i] != 0)
                syn_error = 1;
            s[i] = this.index_of[s[i]];
        }
        if (syn_error) {
            let r = no_eras;
            let deg_phi = no_eras;
            let L = no_eras;
            if (no_eras > 0) {
                for (let i = 0; i < deg_phi + 1; i++)
                    lambda[i] = phi[i] == 0xff ? 0 : this.alpha_to[phi[i]];
                for (let i = deg_phi + 1; i < 2 * this.tt + 1; i++)
                    lambda[i] = 0;
                for (let i = 0; i < 2 * this.tt + 1; i++)
                    b[i] = lambda[i];
            } else {
                lambda[0] = 1;
                for (let i = 1; i < 2 * this.tt + 1; i++)
                    lambda[i] = 0;
                for (let i = 0; i < 2 * this.tt + 1; i++)
                    b[i] = lambda[i];
            }
            while (++r <= 2 * this.tt) {
                let discr_r = 0;
                for (let i = 0; i < 2 * this.tt + 1; i++) {
                    if (lambda[i] != 0 && s[r - i] != 0xff) {
                        let tmp = this.alpha_to[(this.index_of[lambda[i]] + s[r - i]) % 0xff];
                        discr_r ^= tmp;
                    }
                }
                if (discr_r == 0) {
                    tmp_pol[0] = 0;
                    for (let i = 1; i < 2 * this.tt + 1; i++)
                        tmp_pol[i] = b[i - 1];
                    for (let i = 0; i < 2 * this.tt + 1; i++)
                        b[i] = tmp_pol[i];
                } else {
                    T[0] = lambda[0];
                    for (let i = 1; i < 2 * this.tt + 1; i++) {
                        let tmp = b[i - 1] == 0
                            ? 0
                            : this.alpha_to[(this.index_of[discr_r] + this.index_of[b[i - 1]]) % 0xff];
                        T[i] = lambda[i] ^ tmp;
                    }
                    if (2 * L <= r + no_eras - 1) {
                        L = r + no_eras - L;
                        for (let i = 0; i < 2 * this.tt + 1; i++)
                            b[i] = lambda[i] == 0
                                ? 0
                                : this.alpha_to[(this.index_of[lambda[i]] - this.index_of[discr_r] + this.nn) % 0xff];
                        for (let i = 0; i < 2 * this.tt + 1; i++)
                            lambda[i] = T[i];
                    } else {
                        for (let i = 0; i < 2 * this.tt + 1; i++)
                            lambda[i] = T[i];
                        tmp_pol[0] = 0;
                        for (let i = 1; i < 2 * this.tt + 1; i++)
                            tmp_pol[i] = b[i - 1];
                        for (let i = 0; i < 2 * this.tt + 1; i++)
                            b[i] = tmp_pol[i];
                    }
                }
            }
            this.make_rev(lambda, 2 * this.tt + 1);
            let deg_lambda = 2 * this.tt;
            while (lambda[deg_lambda] == 0xff && deg_lambda > 0)
                --deg_lambda;
            if (deg_lambda <= 2 * this.tt) {
                for (let i = 1; i < 2 * this.tt + 1; i++)
                    reg[i] = lambda[i];
                count = 0;
                for (let i = 1; i <= this.nn; i++) {
                    let q = 1;
                    for (let j = 1; j <= deg_lambda; j++)
                        if (reg[j] != 0xff) {
                            reg[j] = (reg[j] + j) % 0xff;
                            q ^= this.alpha_to[reg[j] % 0xff];
                        }
                    if (!q) {
                        root[count] = i;
                        loc[count] = this.nn - i;
                        count++;
                    }
                }
                if (deg_lambda == count) {
                    for (let i = 0; i < 2 * this.tt; i++) {
                        omega[i] = 0;
                        for (let j = 0; j < deg_lambda + 1 && j < i + 1; j++) {
                            let tmp;
                            if (s[i + 1 - j] != 0xff && lambda[j] != 0xff)
                                tmp = this.alpha_to[(s[i + 1 - j] + lambda[j]) % 0xff];
                            else
                                tmp = 0;
                            omega[i] ^= tmp;
                        }
                    }
                    omega[2 * this.tt] = 0;
                    for (let i = 0; i < this.tt; i++) {
                        lambda_pr[2 * i + 1] = 0;
                        lambda_pr[2 * i] = lambda[2 * i + 1] == 0xff ? 0 : this.alpha_to[lambda[2 * i + 1]];
                    }
                    lambda_pr[2 * this.tt] = 0;
                    let deg_omega = 2 * this.tt;
                    while (omega[deg_omega] == 0 && deg_omega > 0)
                        --deg_omega;
                    for (let j = 0; j < count; j++) {
                        let pres_root = root[j];
                        let pres_loc = loc[j];
                        let num1 = 0;
                        for (let i = 0; i < deg_omega + 1; i++) {
                            let tmp;
                            if (omega[i] != 0)
                                tmp = this.alpha_to[(this.index_of[omega[i]] + i * pres_root) % 0xff];
                            else
                                tmp = 0;
                            num1 ^= tmp;
                        }
                        let num2 = this.alpha_to[(pres_root * (this.b0 - 1)) % 0xff];
                        let den = 0;
                        for (let i = 0; i < deg_lambda + 1; i++) {
                            let tmp;
                            if (lambda_pr[i] != 0)
                                tmp = this.alpha_to[(this.index_of[lambda_pr[i]] + i * pres_root) % 0xff];
                            else
                                tmp = 0;
                            den ^= tmp;
                        }
                        if (den == 0) throw new Error('Division by zero');
                        err[pres_loc] = 0;
                        if (num1 != 0) {
                            err[pres_loc] = this.alpha_to[(this.index_of[num1] + this.index_of[num2] + (this.nn - this.index_of[den])) % 0xff];
                        }
                    }
                    this.make_pow(this.recd, this.nn);
                    for (let j = 0; j < count; j++)
                        this.recd[loc[j]] ^= err[loc[j]];
                    return count;
                } else return -2;
            } else return -3;
        } else {
            this.make_pow(this.recd, this.nn);
            return 0;
        }
    }
    make_pow(data, len) { for (let i = 0; i < len; i++) data[i] = this.alpha_to[data[i]]; }
    make_rev(data, len) { for (let i = 0; i < len; i++) data[i] = this.index_of[data[i]]; }
    gen_poly(errlen = 16) {
        let y, x;
        this.gg = new Array(errlen);
        this.gg[0] = this.alpha_to[this.b0];
        for (let i = 1; i < errlen; i++) {
            this.gg[i] = 1;
            for (let j = i; j >= 0; j--) {
                y = j == 0 ? 0 : this.gg[j - 1];
                x = this.gg[j];
                if (x != 0) {
                    x = this.index_of[x] + this.b0 + i;
                    if (x >= 0xff) x -= 0xff;
                    y ^= this.alpha_to[x];
                }
                this.gg[j] = y;
            }
        }
        this.make_rev(this.gg, errlen);
    }
    generate_gf() {
        this.alpha_to = new Array(this.nn + 1);
        this.index_of = new Array(this.nn + 1);
        let mask = 1;
        this.alpha_to[this.nn] = 0;
        this.index_of[0] = this.nn;
        for (let i = 0; i < this.nn; i++) {
            this.alpha_to[i] = mask;
            this.index_of[mask] = i;
            mask <<= 1;
            if (mask >= this.nn + 1) mask ^= this.pp;
        }
    }
    initialize_rs(bits = 8, polynomial = 0x187, index = 0x78, errlen = 16) {
        this.mm = bits;
        if (this.rs_init != this.mm) {
            let j = 1;
            for (let i = 0; i < this.mm; i++, j <<= 1);
            this.nn = j - 1;
            this.pp = polynomial;
            this.b0 = index;
            this.tt = errlen / 2;
            this.kk = this.nn - 2 * this.tt;
            this.generate_gf();
            this.gen_poly(errlen);
            this.curr_errlen = errlen;
            this.recd = new Array(this.nn);
            this.rs_init = this.mm;
        }
        if (this.curr_errlen !== errlen) {
            this.tt = errlen / 2;
            this.kk = this.nn - 2 * this.tt;
            this.gen_poly(errlen);
            this.curr_errlen = errlen;
        }
    }
    reverse_byte_order(data, len) {
        for (let i = 0; i < len >> 1; i++) {
            const x = data[i];
            data[i] = data[len - i - 1];
            data[len - i - 1] = x;
        }
    }
    invert_error_bytes(data, len) { for (let i = 0; i < len; i++) data[i] ^= 0xff; }
    correct_errors(data, errlen, erasure = null) {
        let result = 0;
        let j = 0;
        const erase_pos = new Array(2 * _ReedSolomon.d_tt);
        for (let i = 0; i < this.nn; i++) this.recd[i] = 0;
        if (erasure) {
            this.reverse_byte_order(erasure, data.length);
            for (let i = 0, j = 0; i < data.length; i++)
                if (erasure[i]) erase_pos[j++] = i;
        }
        for (let i = 0; i < data.length; i++) this.recd[i] = data[i];
        this.reverse_byte_order(this.recd, data.length);
        this.invert_error_bytes(this.recd, errlen);
        result = this.eras_dec_rs(erase_pos, j);
        if (result > 0)
            if (this.eras_dec_rs(erase_pos, 0) != 0)
                return -1;
        for (let i = 0; i < data.length; i++) data[i] = this.recd[i];
        this.invert_error_bytes(data, errlen);
        this.reverse_byte_order(data, data.length);
        return result;
    }
}
_ReedSolomon.d_mm = 8;
_ReedSolomon.d_nn = 255;
_ReedSolomon.d_tt = 127;
_ReedSolomon.d_kk = _ReedSolomon.d_nn - 2 * _ReedSolomon.d_tt;
const ReedSolomon = new _ReedSolomon();

const STRIP2_BIN_OFFSET = 0x51;

function combineBinStrips(bins) {
  if (bins.length === 1) return bins[0];
  let total = bins[0].length;
  for (let i = 1; i < bins.length; i++) total += bins[i].length - STRIP2_BIN_OFFSET;
  const out = new Uint8Array(total);
  out.set(bins[0], 0);
  let offset = bins[0].length;
  for (let i = 1; i < bins.length; i++) {
    const tail = bins[i].subarray(STRIP2_BIN_OFFSET);
    out.set(tail, offset);
    offset += tail.length;
  }
  return out;
}

const NINTENDO = new TextEncoder().encode('NINTENDO');
const LONG_RAW = 0xb60;
const SHORT_RAW = 0x750;
const LONG_BIN = 0x840;
const SHORT_BIN = 0x540;

function readNextRaw(bytes, offset) {
  ReedSolomon.initialize_rs();

  const rawheader = new Uint8Array(24);
  let readOffset = offset;
  for (let i = 0; i < 24; i += 2) {
    rawheader[i] = bytes[readOffset];
    rawheader[i + 1] = bytes[readOffset + 1];
    readOffset += 2;
    readOffset += 0x66;
  }

  const header = Array.from(rawheader);
  if (ReedSolomon.correct_errors(header, 16) < 0) return null;

  let stripBlocks = header[4] * header[7];
  if (stripBlocks % 0x66 > 0) stripBlocks += 0x66 - (stripBlocks % 0x66);
  stripBlocks /= 0x66;

  let rawLen = stripBlocks * 0x68;
  if (rawLen <= 0 || offset + rawLen > bytes.length) return null;

  const rawdata = bytes.slice(offset, offset + rawLen);
  let j = 0;
  while (j * 12 < stripBlocks) {
    for (let i = 0; i < 12 && j * 12 + i < stripBlocks; i++) {
      rawdata[(j * 12 + i) * 0x68] = rawheader[i * 2];
      rawdata[(j * 12 + i) * 0x68 + 1] = rawheader[i * 2 + 1];
    }
    j++;
  }

  return rawdata;
}

function deinterleaveDotcode(data, interleave, dotcodePointer, dotcodeInterleave) {
  for (let i = 0; i < 0x40; i++) {
    data[i] = interleave[i * dotcodeInterleave + dotcodePointer];
  }
}

function decodeRawStrip(raw) {
  const binHeader = new Uint8Array(24);
  for (let i = 0; i < 12; i++) {
    binHeader[i * 2] = raw[i * 0x68];
    binHeader[i * 2 + 1] = raw[i * 0x68 + 1];
  }

  const header = Array.from(binHeader);
  if (ReedSolomon.correct_errors(header, 16) < 0) {
    throw new Error('Could not read dotcode header (Reed–Solomon failure)');
  }
  for (let i = 0; i < 24; i++) binHeader[i] = header[i];

  let j = binHeader[4] * binHeader[7] * 0x68;
  const remainder = j % 0x66;
  j = Math.floor(j / 0x66) + (remainder > 0 ? 1 : 0);

  const dotcodeInterleave = binHeader[7];
  const dotcodetemp = new Uint8Array(j * 0x40);
  let dotcodePointer = 0;

  for (let i = 2; i < j; i++) {
    if (i % 0x68 === 0) i += 2;
    dotcodetemp[dotcodePointer++] = raw[i];
  }

  const data = new Uint8Array(0x40);
  const binSize = raw.length >= LONG_RAW ? LONG_BIN : SHORT_BIN;
  const bin = new Uint8Array(binSize);

  deinterleaveDotcode(data, dotcodetemp, 0, dotcodeInterleave);
  let block = Array.from(data);
  if (ReedSolomon.correct_errors(block, 0x10) < 0) {
    throw new Error('Could not decode first dotcode block');
  }
  data.set(block);

  let isNedc = true;
  for (let i = 0; i < 8; i++) {
    if (data[i + 0x1a] !== NINTENDO[i]) {
      isNedc = false;
      break;
    }
  }
  if (!isNedc) throw new Error('Not a Nintendo e-Reader dotcode strip');

  bin.set(data.subarray(0, 0x30));

  for (let i = 1; i < dotcodeInterleave; i++) {
    deinterleaveDotcode(data, dotcodetemp, i, dotcodeInterleave);
    block = Array.from(data);
    if (ReedSolomon.correct_errors(block, 0x10) < 0) {
      throw new Error(`Could not decode dotcode block ${i}`);
    }
    bin.set(block.slice(0, 0x30), i * 0x30);
  }

  return { bin, binHeader, stripSize: raw.length };
}

export function decodeRawToBin(bytes) {
  const strips = [];
  let offset = 0;

  while (offset < bytes.length) {
    const raw = readNextRaw(bytes, offset);
    if (!raw) break;
    strips.push(decodeRawStrip(raw));
    offset += raw.length;
  }

  if (strips.length === 0) {
    throw new Error('Could not decode dotcode .raw file');
  }

  const bins = strips.map((strip) => strip.bin);

  return {
    bin: bins.length > 1 ? combineBinStrips(bins) : bins[0],
    stripCount: strips.length,
    strips,
  };
}

export function looksLikeRaw(bytes) {
  if (bytes.length !== LONG_RAW && bytes.length !== SHORT_RAW) return false;
  try {
    return readNextRaw(bytes, 0) !== null;
  } catch {
    return false;
  }
}
