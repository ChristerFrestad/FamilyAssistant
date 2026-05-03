// Tests for RegenerateDialog — the confirmation surface for the
// always-visible "Generer fra ukens middager" CTA on the Shopping
// screen.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect, describe, vi } from 'vitest';
import { RegenerateDialog } from './RegenerateDialog';

describe('RegenerateDialog', () => {
  test('renders nothing when open=false', () => {
    render(<RegenerateDialog open={false} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('renders title, description, and both action buttons when open', () => {
    render(<RegenerateDialog open={true} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Generer handlelista på nytt?')).toBeInTheDocument();
    expect(screen.getByText(/kjøpte varer og det du har lagt til manuelt/)).toBeInTheDocument();
    expect(screen.getByTestId('regenerate-dialog-cancel')).toBeInTheDocument();
    expect(screen.getByTestId('regenerate-dialog-confirm')).toBeInTheDocument();
  });

  test('cancel button fires onClose', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<RegenerateDialog open={true} onClose={onClose} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByTestId('regenerate-dialog-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('confirm button fires onConfirm and not onClose', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<RegenerateDialog open={true} onClose={onClose} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByTestId('regenerate-dialog-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  test('confirm shows loading state when loading=true', () => {
    render(<RegenerateDialog open={true} onClose={vi.fn()} onConfirm={vi.fn()} loading={true} />);
    const confirmBtn = screen.getByTestId('regenerate-dialog-confirm');
    expect(confirmBtn).toHaveAttribute('aria-busy', 'true');
    expect(confirmBtn).toBeDisabled();
  });

  test('cancel is disabled when loading=true', () => {
    render(<RegenerateDialog open={true} onClose={vi.fn()} onConfirm={vi.fn()} loading={true} />);
    const cancelBtn = screen.getByTestId('regenerate-dialog-cancel');
    expect(cancelBtn).toBeDisabled();
  });
});
