import { render, screen } from '@testing-library/react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/kit/select';

describe('kit Select', () => {
  it('keeps its portalled option surface inside a theme-token scope', () => {
    render(
      <Select open value="alpha">
        <SelectTrigger aria-label="Example select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="alpha">Alpha</SelectItem>
        </SelectContent>
      </Select>,
    );

    expect(screen.getByRole('listbox')).toHaveAttribute('data-mx-theme-host');
  });
});
