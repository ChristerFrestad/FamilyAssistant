// Integration tests for the Family screen.
//
// We don't drive the hook layer here — useFamilyData has its own
// tests. Instead we mount Family with the same providers it sees in
// production (AuthProvider + MemoryRouter), spy on globalThis.fetch
// for the GET /api/family + PUT /api/family/members/:id round-trips,
// and assert that:
//   * skeleton, error, and data states render correctly
//   * the current user's MemberCard gets the (Du)-badge
//   * placeholder buttons (rename + invite) show inline status
//   * the slider triggers a PUT and surfaces save status
//   * single-member rosters render the hint line
//   * a child viewer sees the slider in disabled state

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Family } from './Family';
import { AuthProvider } from '../auth/AuthContext';
import type { AuthUser } from '../auth/authApi';

const TEST_USER: AuthUser = {
  id: 1,
  email: 'christer@frestad.com',
  name: 'Christer',
  role: 'owner',
  avatarUrl: null,
  familyId: 1,
  profileMemberId: 10,
  onboardingCompleted: true,
  synthetic: false,
};

const CHILD_USER: AuthUser = {
  ...TEST_USER,
  id: 2,
  email: 'kid@frestad.com',
  name: 'Storebror',
  role: 'child',
  profileMemberId: 11,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  fetchSpy.mockRestore();
});

function mountFamily(user: AuthUser = TEST_USER): void {
  render(
    <MemoryRouter initialEntries={['/family']}>
      <AuthProvider initialState={{ user, isLoading: false }}>
        <Family />
      </AuthProvider>
    </MemoryRouter>
  );
}

function mockFetchByPath(handlers: Record<string, () => Response>): void {
  // Sprint 9 added an /api/family/invitations fetch that fires
  // alongside /api/family for owners. Pre-fill an empty list when the
  // caller does not supply its own handler so older tests keep
  // passing without each one re-mocking the new endpoint.
  const withDefaults: Record<string, () => Response> = {
    '/api/family/invitations': () => jsonResponse(200, { invitations: [] }),
    ...handlers,
  };
  fetchSpy.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [pattern, handler] of Object.entries(withDefaults)) {
      if (url === pattern || url.startsWith(pattern + '?')) {
        return Promise.resolve(handler());
      }
    }
    return Promise.reject(new Error(`Unmocked fetch: ${url}`));
  });
}

const FAMILY_DATA = {
  family: {
    id: 1,
    name: 'Familie Frestad',
    ownerUserId: 1,
    createdAt: '2026-04-01 12:00:00',
    updatedAt: '2026-04-01 12:00:00',
  },
  profileMembers: [
    {
      id: 10,
      name: 'Christer',
      category: 'adult',
      portionFactor: 1.0,
      sortOrder: 0,
      allergies: null,
      dislikes: null,
      dietTags: [],
      customDietNote: null,
      createdAt: '2026-04-01 12:00:00',
      updatedAt: '2026-04-01 12:00:00',
    },
    {
      id: 11,
      name: 'Storebror',
      category: 'child',
      portionFactor: 0.5,
      sortOrder: 1,
      allergies: null,
      dislikes: null,
      dietTags: [],
      customDietNote: null,
      createdAt: '2026-04-01 12:00:00',
      updatedAt: '2026-04-01 12:00:00',
    },
  ],
  users: [
    {
      id: 1,
      email: 'christer@frestad.com',
      name: 'Christer',
      avatarUrl: null,
      role: 'owner',
      profileMemberId: 10,
      lastSeenAt: null,
    },
  ],
  portionSum: 1.5,
};

describe('Family — initial render', () => {
  test('shows skeleton while fetch is in flight', () => {
    fetchSpy.mockImplementation(() => new Promise(() => undefined));
    mountFamily();
    expect(screen.getByTestId('family-skeleton')).toBeInTheDocument();
  });

  test('renders members grid after fetch resolves', async () => {
    mockFetchByPath({
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountFamily();
    await waitFor(() => {
      expect(screen.getByTestId('family-members-grid')).toBeInTheDocument();
    });
    expect(screen.getByText('Familie Frestad')).toBeInTheDocument();
    expect(screen.getByTestId('member-card-10')).toBeInTheDocument();
    expect(screen.getByTestId('member-card-11')).toBeInTheDocument();
  });

  test('renders error card with retry on fetch failure', async () => {
    mockFetchByPath({
      '/api/family': () => jsonResponse(500, { detail: 'boom' }),
    });
    mountFamily();
    await waitFor(() => {
      expect(screen.getByTestId('family-error')).toBeInTheDocument();
    });
    // Retry triggers a new fetch
    mockFetchByPath({
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    fireEvent.click(screen.getByText(/Prøv igjen/));
    await waitFor(() => {
      expect(screen.getByTestId('family-members-grid')).toBeInTheDocument();
    });
  });
});

describe('Family — current user marker', () => {
  test('marks Christer with (Du)-badge', async () => {
    mockFetchByPath({
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountFamily();
    await waitFor(() => {
      expect(screen.getByTestId('member-card-10')).toBeInTheDocument();
    });
    const christerCard = screen.getByTestId('member-card-10');
    expect(christerCard.querySelector('[data-testid="you-badge"]')).not.toBeNull();
    const kidCard = screen.getByTestId('member-card-11');
    expect(kidCard.querySelector('[data-testid="you-badge"]')).toBeNull();
  });
});

describe('Family — placeholder actions', () => {
  test('Edit button shows placeholder status', async () => {
    mockFetchByPath({
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountFamily();
    await waitFor(() => {
      expect(screen.getByTestId('edit-family-button')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('edit-family-button'));
    expect(screen.getByTestId('edit-placeholder-status')).toBeInTheDocument();
  });

  test('Invite button opens the InviteMemberModal', async () => {
    // Sprint 9 PR #119: invite-member is no longer a placeholder.
    // Clicking opens the real modal owner can fill in.
    mockFetchByPath({
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountFamily();
    await waitFor(() => {
      expect(screen.getByTestId('invite-member-button')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('invite-member-button'));
    expect(screen.getByTestId('invite-email-input')).toBeInTheDocument();
  });
});

describe('Family — portion update', () => {
  test('slider change triggers PUT and surfaces saved status', async () => {
    let callCount = 0;
    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      callCount += 1;
      if (url === '/api/family' && (!init || init.method === 'GET')) {
        return Promise.resolve(jsonResponse(200, FAMILY_DATA));
      }
      if (url === '/api/family/members/10' && init?.method === 'PUT') {
        return Promise.resolve(
          jsonResponse(200, {
            ok: true,
            member: {
              ...FAMILY_DATA.profileMembers[0],
              portionFactor: 1.3,
            },
          })
        );
      }
      return Promise.reject(new Error(`Unmocked fetch: ${url}`));
    });

    mountFamily();
    await waitFor(() => {
      expect(screen.getByTestId('member-card-10')).toBeInTheDocument();
    });

    const sliders = screen.getAllByRole('slider');
    const christerSlider = sliders[0]!;
    fireEvent.change(christerSlider, { target: { value: '1.3' } });

    await waitFor(() => {
      expect(screen.getByTestId('save-status-saved')).toBeInTheDocument();
    });
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  test('rolls back and shows error status when PUT fails', async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/family' && (!init || init.method === 'GET')) {
        return Promise.resolve(jsonResponse(200, FAMILY_DATA));
      }
      if (url === '/api/family/members/10' && init?.method === 'PUT') {
        return Promise.resolve(jsonResponse(403, { detail: 'role-required' }));
      }
      return Promise.reject(new Error(`Unmocked fetch: ${url}`));
    });

    mountFamily();
    await waitFor(() => {
      expect(screen.getByTestId('member-card-10')).toBeInTheDocument();
    });

    const sliders = screen.getAllByRole('slider');
    const christerSlider = sliders[0] as HTMLInputElement;
    fireEvent.change(christerSlider, { target: { value: '1.5' } });

    await waitFor(() => {
      expect(screen.getByTestId('save-status-error')).toBeInTheDocument();
    });
    // Rolled back to original 1.0
    expect(christerSlider.value).toBe('1');
  });
});

describe('Family — single member roster', () => {
  test('shows hint line when there is only one profile member', async () => {
    const singleMemberData = {
      ...FAMILY_DATA,
      profileMembers: [FAMILY_DATA.profileMembers[0]!],
    };
    mockFetchByPath({
      '/api/family': () => jsonResponse(200, singleMemberData),
    });
    mountFamily();
    await waitFor(() => {
      expect(screen.getByTestId('single-member-hint')).toBeInTheDocument();
    });
  });
});

describe('Family — child viewer', () => {
  test('disables sliders when current user is a child', async () => {
    const childFamilyData = {
      ...FAMILY_DATA,
      users: [
        {
          id: 2,
          email: 'kid@frestad.com',
          name: 'Storebror',
          avatarUrl: null,
          role: 'child' as const,
          profileMemberId: 11,
          lastSeenAt: null,
        },
      ],
    };
    mockFetchByPath({
      '/api/family': () => jsonResponse(200, childFamilyData),
    });
    mountFamily(CHILD_USER);
    await waitFor(() => {
      expect(screen.getByTestId('member-card-11')).toBeInTheDocument();
    });
    const sliders = screen.getAllByRole('slider') as HTMLInputElement[];
    sliders.forEach((s) => expect(s).toBeDisabled());
  });
});
