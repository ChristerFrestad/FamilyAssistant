// Tests for the DashboardCard component.
//
// Each render-state of the card has its own assertion: skeleton,
// error + retry, empty + CTA, data + truncation tail. The
// component is generic over T, so we use a tiny fixture type
// (string items) to keep the boilerplate small.

import { render, screen, fireEvent } from '@testing-library/react';
import { test, expect, describe, vi } from 'vitest';
import { DashboardCard } from './DashboardCard';

const baseProps = {
  title: 'Dagens gjøremål',
  emptyMessage: 'Ingen gjøremål for i dag',
  renderItem: (item: string) => <span>{item}</span>,
  itemKey: (item: string, index: number) => `${index}-${item}`,
};

describe('DashboardCard render branches', () => {
  test('renders the skeleton while isLoading=true', () => {
    render(<DashboardCard<string> {...baseProps} data={null} isLoading={true} error={null} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Ingen gjøremål for i dag')).not.toBeInTheDocument();
  });

  test('renders error + retry-knapp when error is non-null', () => {
    const onRetry = vi.fn();
    render(
      <DashboardCard<string>
        {...baseProps}
        data={null}
        isLoading={false}
        error={new Error('500')}
        onRetry={onRetry}
      />
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /Prøv igjen/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('renders empty-state with CTA when data is empty array', () => {
    const onClick = vi.fn();
    render(
      <DashboardCard<string>
        {...baseProps}
        data={[]}
        isLoading={false}
        error={null}
        emptyCta={{ label: 'Legg til', onClick }}
      />
    );
    expect(screen.getByText('Ingen gjøremål for i dag')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Legg til' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('renders item list when data has entries', () => {
    render(
      <DashboardCard<string>
        {...baseProps}
        data={['Vaske gulv', 'Lufte rom']}
        isLoading={false}
        error={null}
      />
    );
    expect(screen.getByText('Vaske gulv')).toBeInTheDocument();
    expect(screen.getByText('Lufte rom')).toBeInTheDocument();
  });

  test('shows the "+ N more" tail when data exceeds the limit', () => {
    render(
      <DashboardCard<string>
        {...baseProps}
        data={['a', 'b', 'c', 'd', 'e']}
        isLoading={false}
        error={null}
        limit={2}
        formatMore={(n) => `+ ${n} flere`}
      />
    );
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
    expect(screen.queryByText('c')).not.toBeInTheDocument();
    expect(screen.getByText('+ 3 flere')).toBeInTheDocument();
  });

  test('skips the "+ N more" tail when remaining is zero', () => {
    render(
      <DashboardCard<string>
        {...baseProps}
        data={['a', 'b']}
        isLoading={false}
        error={null}
        limit={5}
        formatMore={(n) => `+ ${n} flere`}
      />
    );
    expect(screen.queryByText(/flere/i)).not.toBeInTheDocument();
  });

  test('isLoading takes priority over a stale data array', () => {
    // Retry use-case: previous fetch produced data, retry kicks off
    // a new fetch which sets isLoading=true. The card must show the
    // skeleton, not the stale data, so the retry visually resets.
    render(
      <DashboardCard<string> {...baseProps} data={['a', 'b']} isLoading={true} error={null} />
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('a')).not.toBeInTheDocument();
  });
});
