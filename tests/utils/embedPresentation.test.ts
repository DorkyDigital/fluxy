import {
  compactEmbedDescription,
  formatCompactPageIndicator,
  joinCompactFooterParts,
  trimFooterPrompt,
} from '../../src/utils/embedPresentation';

describe('embedPresentation', () => {
  test('trims footer prompts to the leading action', () => {
    expect(trimFooterPrompt('!help <command> for details • Dashboard: fluxy.gay')).toBe('!help <command> for details');
  });

  test('formats compact page indicators', () => {
    expect(formatCompactPageIndicator(2, 4)).toBe('2/4 ◄►');
    expect(formatCompactPageIndicator(1, 1)).toBeNull();
  });

  test('joins footer parts without empty segments', () => {
    expect(joinCompactFooterParts(['!help <command> for details', null, '2/4 ◄►'])).toBe('!help <command> for details • 2/4 ◄►');
  });

  test('keeps only the first sentence of a long description', () => {
    expect(compactEmbedDescription([
      'Privately alert the staff team about an issue. Your message is deleted immediately.',
      '',
      'Extra detail',
    ])).toBe('Privately alert the staff team about an issue.');
  });
});
