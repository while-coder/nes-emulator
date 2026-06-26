import Mappers from '../../../../node_modules/jsnes/src/mappers/index.js'
import Mapper0 from '../../../../node_modules/jsnes/src/mappers/mapper0.js'

// JY Company / mapper 90. jsnes 2.1.0 does not ship this mapper, but several
// Chinese pirate and hack ROMs use it (for example Super Mario World NES).
class Mapper90 extends Mapper0 {
  static mapperName = 'JY Company'

  constructor(nes) {
    super(nes)
    this.irqMode = 0
    this.irqPre = 0
    this.irqPreSize = 0
    this.irqCount = 0
    this.irqXor = 0
    this.irqEnabled = 0
    this.mul = [0xff, 0xff]
    this.regie = 0xff
    this.tkcom = [0, 0, 0, 0]
    this.prgBanks = [0xff, 0xff, 0xff, 0xff]
    this.chrLow = new Array(8).fill(0xff)
    this.chrHigh = new Array(8).fill(0xff)
    this.chrLatch = [0, 4]
    this.names = [0, 0, 0, 0]
    this.tekker = 0
    this.lastPpuRead = -1
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error('Mapper90: Invalid ROM! Unable to load.')
    }

    this.loadBatteryRam()
    this.updatePrg()
    this.updateChr()
    this.updateMirroring()
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET)
  }

  load(address) {
    if (address >= 0x5000 && address < 0x6000) {
      return this.readMultiplyRegister(address)
    }
    return super.load(address)
  }

  write(address, value) {
    value &= 0xff

    if (address < 0x5000) {
      super.write(address, value)
      return
    }

    if (address < 0x6000) {
      this.writeMultiplyRegister(address, value)
      this.clockCpuWriteIrq()
      return
    }

    if (address < 0x8000) {
      if ((this.tkcom[0] & 0x80) === 0) {
        super.write(address, value)
      }
      this.clockCpuWriteIrq()
      return
    }

    if (address < 0x9000) {
      this.prgBanks[address & 0x03] = value
      this.updatePrg()
    } else if (address < 0xa000) {
      this.chrLow[address & 0x07] = value
      this.updateChr()
    } else if (address < 0xb000) {
      this.chrHigh[address & 0x07] = value
      this.updateChr()
    } else if (address < 0xc000) {
      this.writeNametableRegister(address, value)
    } else if (address < 0xd000) {
      this.writeIrqRegister(address, value)
    } else if (address < 0xd600) {
      this.tkcom[address & 0x03] = value
      this.updatePrg()
      this.updateChr()
      this.updateMirroring()
    }

    this.clockCpuWriteIrq()
  }

  writeMultiplyRegister(address, value) {
    switch (address & 0x5c03) {
      case 0x5800:
        this.mul[0] = value
        break
      case 0x5801:
        this.mul[1] = value
        break
      case 0x5803:
        this.regie = value
        break
    }
  }

  readMultiplyRegister(address) {
    const product = this.mul[0] * this.mul[1]
    switch (address & 0x5c03) {
      case 0x5800:
        return product & 0xff
      case 0x5801:
        return (product >> 8) & 0xff
      case 0x5803:
        return this.regie
      default:
        return this.tekker
    }
  }

  writeNametableRegister(address, value) {
    const index = address & 0x03
    if ((address & 0x04) !== 0) {
      this.names[index] = (this.names[index] & 0x00ff) | (value << 8)
    } else {
      this.names[index] = (this.names[index] & 0xff00) | value
    }
    this.updateMirroring()
  }

  writeIrqRegister(address, value) {
    switch (address & 0x07) {
      case 0:
        this.irqEnabled = value & 0x01
        break
      case 1:
        this.irqMode = value
        break
      case 2:
        this.irqEnabled = 0
        break
      case 3:
        this.irqEnabled = 1
        break
      case 4:
        this.irqPre = value ^ this.irqXor
        break
      case 5:
        this.irqCount = value ^ this.irqXor
        break
      case 6:
        this.irqXor = value
        break
      case 7:
        this.irqPreSize = value
        break
    }
  }

  updateMirroring() {
    switch (this.tkcom[1] & 0x03) {
      case 0:
        this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING)
        break
      case 1:
        this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING)
        break
      case 2:
        this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING)
        break
      case 3:
        this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING2)
        break
    }
  }

  updatePrg() {
    const bankMode = (this.tkcom[3] & 0x06) << 5
    switch (this.tkcom[0] & 0x07) {
      case 0:
        if ((this.tkcom[0] & 0x80) !== 0) {
          this.load8kRomBank((((this.prgBanks[3] << 2) + 3) & 0x3f) | bankMode, 0x6000)
        }
        this.load32kRomBank(0x0f | ((this.tkcom[3] & 0x06) << 3), 0x8000)
        break
      case 1:
        if ((this.tkcom[0] & 0x80) !== 0) {
          this.load8kRomBank((((this.prgBanks[3] << 1) + 1) & 0x3f) | bankMode, 0x6000)
        }
        this.loadRomBank((this.prgBanks[1] & 0x1f) | ((this.tkcom[3] & 0x06) << 4), 0x8000)
        this.loadRomBank(0x1f | ((this.tkcom[3] & 0x06) << 4), 0xc000)
        break
      case 2:
      case 3:
        if ((this.tkcom[0] & 0x80) !== 0) {
          this.load8kRomBank((this.prgBanks[3] & 0x3f) | bankMode, 0x6000)
        }
        this.load8kRomBank((this.prgBanks[0] & 0x3f) | bankMode, 0x8000)
        this.load8kRomBank((this.prgBanks[1] & 0x3f) | bankMode, 0xa000)
        this.load8kRomBank((this.prgBanks[2] & 0x3f) | bankMode, 0xc000)
        this.load8kRomBank(0x3f | bankMode, 0xe000)
        break
      case 4:
        if ((this.tkcom[0] & 0x80) !== 0) {
          this.load8kRomBank((((this.prgBanks[3] << 2) + 3) & 0x3f) | bankMode, 0x6000)
        }
        this.load32kRomBank((this.prgBanks[3] & 0x0f) | ((this.tkcom[3] & 0x06) << 3), 0x8000)
        break
      case 5:
        if ((this.tkcom[0] & 0x80) !== 0) {
          this.load8kRomBank((((this.prgBanks[3] << 1) + 1) & 0x3f) | bankMode, 0x6000)
        }
        this.loadRomBank((this.prgBanks[1] & 0x1f) | ((this.tkcom[3] & 0x06) << 4), 0x8000)
        this.loadRomBank((this.prgBanks[3] & 0x1f) | ((this.tkcom[3] & 0x06) << 4), 0xc000)
        break
      case 6:
      case 7:
        if ((this.tkcom[0] & 0x80) !== 0) {
          this.load8kRomBank((this.prgBanks[3] & 0x3f) | bankMode, 0x6000)
        }
        this.load8kRomBank((this.prgBanks[0] & 0x3f) | bankMode, 0x8000)
        this.load8kRomBank((this.prgBanks[1] & 0x3f) | bankMode, 0xa000)
        this.load8kRomBank((this.prgBanks[2] & 0x3f) | bankMode, 0xc000)
        this.load8kRomBank((this.prgBanks[3] & 0x3f) | bankMode, 0xe000)
        break
    }
  }

  updateChr() {
    if (this.nes.rom.vromCount === 0) return

    let bank = 0
    let mask = 0xffff
    if ((this.tkcom[3] & 0x20) === 0) {
      bank = (this.tkcom[3] & 0x01) | ((this.tkcom[3] & 0x18) >> 2)
      switch (this.tkcom[0] & 0x18) {
        case 0x00:
          bank <<= 5
          mask = 0x1f
          break
        case 0x08:
          bank <<= 6
          mask = 0x3f
          break
        case 0x10:
          bank <<= 7
          mask = 0x7f
          break
        case 0x18:
          bank <<= 8
          mask = 0xff
          break
      }
    }

    switch (this.tkcom[0] & 0x18) {
      case 0x00:
        this.load8kVromBank((((this.chrLow[0] | (this.chrHigh[0] << 8)) & mask) | bank) * 2, 0x0000)
        break
      case 0x08:
        this.loadVromBank(((this.chrLow[this.chrLatch[0]] | (this.chrHigh[this.chrLatch[0]] << 8)) & mask) | bank, 0x0000)
        this.loadVromBank(((this.chrLow[this.chrLatch[1]] | (this.chrHigh[this.chrLatch[1]] << 8)) & mask) | bank, 0x1000)
        break
      case 0x10:
        for (let i = 0; i < 8; i += 2) {
          this.load2kVromBank(((this.chrLow[i] | (this.chrHigh[i] << 8)) & mask) | bank, i << 10)
        }
        break
      case 0x18:
        for (let i = 0; i < 8; i++) {
          this.load1kVromBank(((this.chrLow[i] | (this.chrHigh[i] << 8)) & mask) | bank, i << 10)
        }
        break
    }
  }

  clockIrqCounter() {
    if ((this.irqMode & 0x03) === 1) {
      for (let i = 0; i < 8; i++) this.clockIrqPrescaler()
    }
  }

  latchAccess(address) {
    if ((this.irqMode & 0x03) === 2 && this.lastPpuRead !== address) {
      this.clockIrqPrescaler()
      this.clockIrqPrescaler()
      this.lastPpuRead = address
    }
    this.chrLatch[0] = 0
    this.chrLatch[1] = 4
  }

  clockCpuWriteIrq() {
    if ((this.irqMode & 0x03) === 3) {
      this.clockIrqPrescaler()
    }
  }

  clockIrqPrescaler() {
    const premask = (this.irqMode & 0x04) !== 0 ? 0x07 : 0xff
    if ((this.irqMode >> 6) === 1) {
      this.irqPre = (this.irqPre + 1) & 0xff
      if ((this.irqPre & premask) === 0) this.clockIrqCounterCore()
    } else if ((this.irqMode >> 6) === 2) {
      this.irqPre = (this.irqPre - 1) & 0xff
      if ((this.irqPre & premask) === premask) this.clockIrqCounterCore()
    }
  }

  clockIrqCounterCore() {
    if ((this.irqMode >> 6) === 1) {
      this.irqCount = (this.irqCount + 1) & 0xff
      if (this.irqCount === 0 && this.irqEnabled) {
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL)
      }
    } else if ((this.irqMode >> 6) === 2) {
      this.irqCount = (this.irqCount - 1) & 0xff
      if (this.irqCount === 0xff && this.irqEnabled) {
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL)
      }
    }
  }

  toJSON() {
    const state = super.toJSON()
    state.irqMode = this.irqMode
    state.irqPre = this.irqPre
    state.irqPreSize = this.irqPreSize
    state.irqCount = this.irqCount
    state.irqXor = this.irqXor
    state.irqEnabled = this.irqEnabled
    state.mul = this.mul
    state.regie = this.regie
    state.tkcom = this.tkcom
    state.prgBanks = this.prgBanks
    state.chrLow = this.chrLow
    state.chrHigh = this.chrHigh
    state.chrLatch = this.chrLatch
    state.names = this.names
    state.tekker = this.tekker
    state.lastPpuRead = this.lastPpuRead
    return state
  }

  fromJSON(state) {
    super.fromJSON(state)
    this.irqMode = state.irqMode
    this.irqPre = state.irqPre
    this.irqPreSize = state.irqPreSize
    this.irqCount = state.irqCount
    this.irqXor = state.irqXor
    this.irqEnabled = state.irqEnabled
    this.mul = state.mul
    this.regie = state.regie
    this.tkcom = state.tkcom
    this.prgBanks = state.prgBanks
    this.chrLow = state.chrLow
    this.chrHigh = state.chrHigh
    this.chrLatch = state.chrLatch
    this.names = state.names
    this.tekker = state.tekker
    this.lastPpuRead = state.lastPpuRead
    this.updatePrg()
    this.updateChr()
    this.updateMirroring()
  }
}

Mappers[90] = Mapper90

