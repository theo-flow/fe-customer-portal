import { describe, it, expect } from 'vitest'
import type { FormField } from '../sign-form'
import { askedSteps, emailLines, inReadingOrder, roleColour } from '../sign-form-preview'

const box = (over: Partial<FormField>): FormField => ({
  field_id: 'x', field_type: 'signature', role: 'Customer', page: 1, x: 0.5, y: 0.5, width: 0.2, height: 0.03,
  instruction: 'Sign here', required: true, ...over,
})

const consent: FormField[] = [
  box({ field_id: 'n', field_type: 'text', page: 1, y: 0.16, instruction: 'Full names and surname' }),
  box({ field_id: 'i', field_type: 'text', page: 1, y: 0.18, instruction: 'Identity number' }),
  box({ field_id: 's', field_type: 'signature', page: 2, y: 0.38, x: 0.2, instruction: 'Add your signature at the bottom of the page' }),
  box({ field_id: 'a', field_type: 'text', page: 2, y: 0.14, x: 0.1, instruction: 'Where you live (home address), line 2', required: false }),
  box({ field_id: 'c1', field_type: 'choice', page: 2, y: 0.27, x: 0.4, instruction: 'Is the property occupied by you?', choice_group: 'occupied', option: 'is' }),
  box({ field_id: 'c2', field_type: 'choice', page: 2, y: 0.27, x: 0.42, instruction: 'Is the property occupied by you?', choice_group: 'occupied', option: 'is not' }),
  box({ field_id: 'd', field_type: 'date', page: 2, y: 0.49, x: 0.2, instruction: 'Add the date you signed' }),
  box({ field_id: 'r', field_type: 'read_name', page: 1, instruction: 'Read from the document' }),
  box({ field_id: 'w', field_type: 'signature', role: 'Witness', page: 2, instruction: 'Sign as a witness.' }),
]

describe('the signing email lines, as fn-13 writes them', () => {
  it('one line per page; details and choices said once, then date and signature', () => {
    // same case as fn-13's test_email_turns_typed_answers_and_choices_into_one_instruction_per_page
    expect(emailLines(consent, 'Customer')).toEqual([
      'Page 1: Fill in your details on the highlighted lines.',
      'Page 2: Fill in your details on the highlighted lines. Choose the option that applies on the highlighted words. '
        + 'Add the date you signed. Add your signature at the bottom of the page.',
    ])
  })

  it('only that person\'s boxes, with no doubled full stop', () => {
    expect(emailLines(consent, 'Witness')).toEqual(['Page 2: Sign as a witness.'])
  })
})

describe('what each person is asked', () => {
  it('details first (questions in reading order, choices once with their options), then signing', () => {
    expect(askedSteps(consent, 'Customer')).toEqual([
      { title: 'Your details', items: [
        'Full names and surname', 'Identity number', 'Where you live (home address), line 2 (optional)',
        'Is the property occupied by you? (pick one: is / is not)',
      ] },
      { title: 'Signature', items: [] },
      { title: 'The date', items: [] },
    ])
  })

  it('never shows boxes that are only read from an upload', () => {
    expect(JSON.stringify(askedSteps(consent, 'Customer'))).not.toContain('Read from the document')
  })
})

describe('numbering and colours', () => {
  it('numbers boxes page by page, top to bottom', () => {
    expect(inReadingOrder(consent.filter(f => f.role === 'Customer')).map(f => f.field_id).slice(0, 3)).toEqual(['n', 'i', 'r'])
  })

  it('gives each role its own colour', () => {
    expect(roleColour(['Customer 1', 'Customer 2'], 'Customer 1')).not.toBe(roleColour(['Customer 1', 'Customer 2'], 'Customer 2'))
  })
})
