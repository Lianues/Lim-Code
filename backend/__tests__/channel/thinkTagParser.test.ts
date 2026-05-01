import { StreamAccumulator } from '../../modules/channel/StreamAccumulator'
import { OpenAIFormatter } from '../../modules/channel/formatters/openai'
import { ThinkTagParser, splitThinkTagsFromText } from '../../modules/channel/thinkTagParser'

describe('leading think tag extraction', () => {
  it('splits a leading <think> block into a thought part', () => {
    expect(splitThinkTagsFromText('<think>reasoning</think>final answer')).toEqual([
      { text: 'reasoning', thought: true },
      { text: 'final answer' }
    ])
  })

  it('allows whitespace before the leading proxy think block', () => {
    expect(splitThinkTagsFromText('\n\n<think>reasoning</think>final answer')).toEqual([
      { text: 'reasoning', thought: true },
      { text: 'final answer' }
    ])
  })

  it('parses multiple leading think blocks before the normal answer starts', () => {
    expect(splitThinkTagsFromText('<think>first</think>\n<think>second</think>answer')).toEqual([
      { text: 'first\nsecond', thought: true },
      { text: 'answer' }
    ])
  })

  it('preserves <think> tags that appear after normal text has started', () => {
    expect(splitThinkTagsFromText('before <think>example</think> after')).toEqual([
      { text: 'before <think>example</think> after' }
    ])
  })

  it('preserves markdown/code examples instead of folding them', () => {
    const markdown = 'Example:\n```xml\n<think>demo</think>\n```'
    expect(splitThinkTagsFromText(markdown)).toEqual([{ text: markdown }])
  })

  it('does not leak partial leading tags while streaming', () => {
    const parser = new ThinkTagParser()

    expect(parser.process('<th')).toEqual([])
    expect(parser.process('ink>reason')).toEqual([{ text: 'reason', thought: true }])
    expect(parser.process('</thi')).toEqual([])
    expect(parser.process('nk>answer')).toEqual([{ text: 'answer' }])
  })

  it('does not hide similar but non-tag text forever', () => {
    const parser = new ThinkTagParser()

    expect(parser.process('<thi')).toEqual([])
    expect(parser.process('s is ordinary text')).toEqual([{ text: '<this is ordinary text' }])
  })

  it('treats an unfinished leading think block as thought content when finalized', () => {
    const parser = new ThinkTagParser()

    expect(parser.process('<think>reason')).toEqual([{ text: 'reason', thought: true }])
    expect(parser.finalize()).toEqual([])
  })
})

describe('OpenAI formatter think-tag compatibility', () => {
  it('parses non-stream leading content with <think> tags into collapsible thought parts', () => {
    const formatter = new OpenAIFormatter()
    const response = formatter.parseResponse({
      model: 'relay-model',
      choices: [
        {
          message: {
            role: 'assistant',
            content: '<think>relay reasoning</think>visible answer'
          },
          finish_reason: 'stop'
        }
      ]
    })

    expect(response.content.parts).toEqual([
      { text: 'relay reasoning', thought: true },
      { text: 'visible answer' }
    ])
  })

  it('leaves non-leading <think> tags in normal text', () => {
    const formatter = new OpenAIFormatter()
    const response = formatter.parseResponse({
      model: 'relay-model',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Here is an example: <think>demo</think>'
          },
          finish_reason: 'stop'
        }
      ]
    })

    expect(response.content.parts).toEqual([
      { text: 'Here is an example: <think>demo</think>' }
    ])
  })
})

describe('StreamAccumulator think-tag compatibility', () => {
  it('normalizes streamed leading <think> tags before they reach the UI', () => {
    const accumulator = new StreamAccumulator('function_call', () => 'tool-id')

    expect(accumulator.add({ delta: [{ text: '<thi' }], done: false })).toEqual([])
    expect(accumulator.add({ delta: [{ text: 'nk>streamed reasoning' }], done: false })).toEqual([
      { text: 'streamed reasoning', thought: true }
    ])
    expect(accumulator.add({ delta: [{ text: '</think>streamed answer' }], done: true })).toEqual([
      { text: 'streamed answer' }
    ])

    expect(accumulator.getContent().parts).toEqual([
      { text: 'streamed reasoning', thought: true },
      { text: 'streamed answer' }
    ])
  })

  it('does not fold streamed <think> tags after normal text has started', () => {
    const accumulator = new StreamAccumulator('function_call', () => 'tool-id')

    expect(accumulator.add({ delta: [{ text: 'Example: ' }], done: false })).toEqual([
      { text: 'Example: ' }
    ])
    expect(accumulator.add({ delta: [{ text: '<think>demo</think>' }], done: true })).toEqual([
      { text: '<think>demo</think>' }
    ])

    expect(accumulator.getContent().parts).toEqual([
      { text: 'Example: <think>demo</think>' }
    ])
  })
})
