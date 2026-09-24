// Tests for AddMemberModal.
//
// Covers:
//   - Renders title + form fields when open
//   - Name validation: blank submit disabled; empty after blur shows error
//   - Category radiogroup defaults to adult; switching updates selection
//   - Submit success calls onSuccess with the member and onClose
//   - Server error renders generic alert and stays open
//   - Cancel button calls onClose
//   - Form resets when closed and re-opened

import { test, expect, vi, describe, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddMemberModal } from './AddMemberModal';
import type { ProfileMember } from '../../family/familyApi';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SAMPLE_MEMBER: ProfileMember = {
  id: 12,
  name: 'Lillebror',
  category: 'child',
  portionFactor: 0.4,
  sortOrder: 2,
  allergies: null,
  dislikes: null,
  dietTags: [],
  customDietNote: null,
  createdAt: '2026-09-24 12:00:00',
  updatedAt: '2026-09-24 12:00:00',
};

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  fetchSpy.mockRestore();
});

describe('AddMemberModal', () => {
  test('renders title and primary form controls when open', () => {
    render(<AddMemberModal open={true} onClose={() => undefined} onSuccess={() => undefined} />);
    expect(screen.getByText(/Legg til medlem/i)).toBeInTheDocument();
    expect(screen.getByTestId('add-member-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('add-member-category-fieldset')).toBeInTheDocument();
    expect(screen.getByTestId('add-member-submit')).toBeDisabled();
    expect(screen.getByTestId('add-member-category-adult')).toHaveAttribute('aria-checked', 'true');
  });

  test('does not render anything when open=false', () => {
    render(<AddMemberModal open={false} onClose={() => undefined} onSuccess={() => undefined} />);
    expect(screen.queryByTestId('add-member-name-input')).not.toBeInTheDocument();
  });

  test('shows name-required error after blur with empty value', () => {
    render(<AddMemberModal open={true} onClose={() => undefined} onSuccess={() => undefined} />);
    const input = screen.getByTestId('add-member-name-input');
    fireEvent.blur(input);
    expect(screen.getByText(/Navn er påkrevd/i)).toBeInTheDocument();
    expect(screen.getByTestId('add-member-submit')).toBeDisabled();
  });

  test('category switch marks the selected radio', () => {
    render(<AddMemberModal open={true} onClose={() => undefined} onSuccess={() => undefined} />);
    fireEvent.click(screen.getByTestId('add-member-category-teen'));
    expect(screen.getByTestId('add-member-category-teen')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('add-member-category-adult')).toHaveAttribute('aria-checked', 'false');
  });

  test('submits and calls onSuccess on 200', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true, member: SAMPLE_MEMBER }));
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<AddMemberModal open={true} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByTestId('add-member-name-input'), {
      target: { value: 'Lillebror' },
    });
    fireEvent.click(screen.getByTestId('add-member-category-child'));
    fireEvent.click(screen.getByTestId('add-member-submit'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(SAMPLE_MEMBER));
    expect(onClose).toHaveBeenCalled();
    const call = fetchSpy.mock.calls[0];
    const body = JSON.parse((call?.[1] as { body?: string })?.body ?? '{}');
    expect(body.name).toBe('Lillebror');
    expect(body.category).toBe('child');
    expect(typeof body.portionFactor).toBe('number');
  });

  test('500 from server renders generic error and stays open', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(500, { detail: 'boom' }));
    const onClose = vi.fn();
    render(<AddMemberModal open={true} onClose={onClose} onSuccess={() => undefined} />);
    fireEvent.change(screen.getByTestId('add-member-name-input'), {
      target: { value: 'Lillebror' },
    });
    fireEvent.click(screen.getByTestId('add-member-submit'));
    await waitFor(() => expect(screen.getByTestId('add-member-generic-error')).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  test('cancel button closes the modal', () => {
    const onClose = vi.fn();
    render(<AddMemberModal open={true} onClose={onClose} onSuccess={() => undefined} />);
    fireEvent.click(screen.getByTestId('add-member-cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  test('form resets when closed and re-opened', () => {
    const { rerender } = render(
      <AddMemberModal open={true} onClose={() => undefined} onSuccess={() => undefined} />
    );
    fireEvent.change(screen.getByTestId('add-member-name-input'), {
      target: { value: 'Temp' },
    });
    fireEvent.click(screen.getByTestId('add-member-category-teen'));
    rerender(<AddMemberModal open={false} onClose={() => undefined} onSuccess={() => undefined} />);
    rerender(<AddMemberModal open={true} onClose={() => undefined} onSuccess={() => undefined} />);
    expect(screen.getByTestId('add-member-name-input')).toHaveValue('');
    expect(screen.getByTestId('add-member-category-adult')).toHaveAttribute('aria-checked', 'true');
  });
});
