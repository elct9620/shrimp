import { describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import { PinoLogger, createPinoLogger } from '../../../src/infrastructure/logger/pino-logger'
import type { LoggerPort } from '../../../src/use-cases/ports/logger'

function makeFakePino(childResult?: unknown): Logger {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => childResult),
  } as unknown as Logger
}

describe('PinoLogger', () => {
  describe('delegation without context', () => {
    it.each([
      ['trace'],
      ['debug'],
      ['info'],
      ['warn'],
      ['error'],
      ['fatal'],
    ] as const)('should forward message to pino.%s without wrapping when context is absent', (method) => {
      const fake = makeFakePino()
      const logger = new PinoLogger(fake)

      logger[method]('hello')

      expect(fake[method]).toHaveBeenCalledOnce()
      expect(fake[method]).toHaveBeenCalledWith('hello')
    })
  })

  describe('delegation with context', () => {
    it.each([
      ['trace'],
      ['debug'],
      ['info'],
      ['warn'],
      ['error'],
      ['fatal'],
    ] as const)('should swap argument order so pino.%s receives (context, message)', (method) => {
      const fake = makeFakePino()
      const logger = new PinoLogger(fake)
      const ctx = { requestId: 'abc' }

      logger[method]('hello', ctx)

      expect(fake[method]).toHaveBeenCalledOnce()
      expect(fake[method]).toHaveBeenCalledWith(ctx, 'hello')
    })
  })

  describe('child()', () => {
    it('should call pino.child(bindings) and wrap the result in a new PinoLogger', () => {
      const childFake = makeFakePino()
      const fake = makeFakePino(childFake)

      const logger = new PinoLogger(fake)
      const bindings = { module: 'test' }
      const child = logger.child(bindings)

      expect(fake.child).toHaveBeenCalledWith(bindings)
      expect(child).not.toBe(logger)
      expect(child).toBeInstanceOf(PinoLogger)

      child.info('from child')
      expect(childFake.info).toHaveBeenCalledWith('from child')
    })

    it('should return a value that satisfies the LoggerPort interface', () => {
      const childFake = makeFakePino()
      const fake = makeFakePino(childFake)

      const logger = new PinoLogger(fake)
      const child: LoggerPort = logger.child({ module: 'test' })

      expect(child).toBeDefined()
      expect(typeof child.info).toBe('function')
      expect(typeof child.child).toBe('function')
    })
  })

  describe('createPinoLogger factory', () => {
    it('should create a logger that accepts log calls without throwing when pretty is false', () => {
      const logger = createPinoLogger({ level: 'silent', pretty: false })

      expect(() => logger.info('test message')).not.toThrow()
      expect(() => logger.debug('debug', { key: 'value' })).not.toThrow()
    })

    it('should create a logger whose child is a distinct PinoLogger instance', () => {
      const logger = createPinoLogger({ level: 'silent', pretty: false })
      const child = logger.child({ service: 'test' })

      expect(child).toBeInstanceOf(PinoLogger)
      expect(child).not.toBe(logger)
    })

    it('should create a logger with default pretty (undefined) that still accepts log calls', () => {
      const logger = createPinoLogger({ level: 'silent' })

      expect(() => logger.warn('test')).not.toThrow()
    })
  })
})
