// Tests for ShoppingHeader.

import { render, screen } from '@testing-library/react';
import { test, expect, describe } from 'vitest';
import { ShoppingHeader } from './ShoppingHeader';

const baseStats = {
  total: 5,
  bought: 2,
  remaining: 3,
  remainingPriceSum: 0,
  itemsWithPriceCount: 0,
};

describe('ShoppingHeader', () => {
  test('renders the title', () => {
    render(<ShoppingHeader stats={baseStats} />);
    expect(screen.getByRole('heading', { name: 'Handleliste', level: 1 })).toBeInTheDocument();
  });

  test('renders bought-of-total + remaining when items exist', () => {
    render(<ShoppingHeader stats={baseStats} />);
    expect(screen.getByText('2 av 5 plukket')).toBeInTheDocument();
    expect(screen.getByText('3 igjen')).toBeInTheDocument();
  });

  test('hides stats when isEmpty', () => {
    render(<ShoppingHeader stats={baseStats} isEmpty={true} />);
    expect(screen.queryByText(/plukket/)).toBeNull();
  });

  test('hides stats when total = 0', () => {
    render(
      <ShoppingHeader
        stats={{ total: 0, bought: 0, remaining: 0, remainingPriceSum: 0, itemsWithPriceCount: 0 }}
      />
    );
    expect(screen.queryByText(/plukket/)).toBeNull();
  });

  test('renders remaining price when items have estPrice', () => {
    render(
      <ShoppingHeader
        stats={{
          total: 5,
          bought: 2,
          remaining: 3,
          remainingPriceSum: 120,
          itemsWithPriceCount: 3,
        }}
      />
    );
    expect(screen.getByTestId('shopping-header-remaining-price')).toHaveTextContent('120 kr');
  });

  test('omits remaining price when 0', () => {
    render(<ShoppingHeader stats={baseStats} />);
    expect(screen.queryByTestId('shopping-header-remaining-price')).toBeNull();
  });

  test('uses formatPrice when provided', () => {
    render(
      <ShoppingHeader
        stats={{
          total: 5,
          bought: 2,
          remaining: 3,
          remainingPriceSum: 120,
          itemsWithPriceCount: 3,
        }}
        formatPrice={(kr) => `kr ${kr},-`}
      />
    );
    expect(screen.getByTestId('shopping-header-remaining-price')).toHaveTextContent('kr 120,-');
  });

  test('shows partial-price hint when fewer items have prices than remaining', () => {
    render(
      <ShoppingHeader
        stats={{
          total: 5,
          bought: 2,
          remaining: 3,
          remainingPriceSum: 50,
          itemsWithPriceCount: 1,
        }}
      />
    );
    // The visually-hidden span carries the hint text.
    expect(screen.getByText('Inkluderer 1 av 3 varer med kjente priser')).toBeInTheDocument();
  });
});
