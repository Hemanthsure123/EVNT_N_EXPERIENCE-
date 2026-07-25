import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormField } from './form-field';
import { Input } from './input';

describe('FormField', () => {
  it('associates the label with its control', () => {
    render(
      <FormField label="Email" htmlFor="email">
        <Input id="email" />
      </FormField>,
    );
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('renders an error as role=alert and wires aria-invalid + aria-describedby', () => {
    render(
      <FormField label="Email" htmlFor="email" error="Enter a valid email address">
        <Input id="email" />
      </FormField>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address');
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain('email-error');
  });

  it('shows the description when there is no error', () => {
    render(
      <FormField label="Name" htmlFor="name" description="As on your ID">
        <Input id="name" />
      </FormField>,
    );
    expect(screen.getByText('As on your ID')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
