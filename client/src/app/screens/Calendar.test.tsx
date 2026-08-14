// Integration tests for the Calendar screen.
//
// We mount Calendar with the same providers it sees in production
// (AuthProvider + MemoryRouter), spy on globalThis.fetch for
// GET/POST/DELETE /api/calendar/events, and assert that:
//   * the i18n heading renders
//   * empty state, list, and error states render
//   * an adult can add an event (POST body matches the form)
//   * a child viewer does not see Add or Delete
//   * delete calls DELETE /api/calendar/events/:id

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { Calendar } from './Calendar';
import { AuthProvider } from '../auth/AuthContext';
import type { AuthUser } from '../auth/authApi';

const ADULT_USER: AuthUser = {
  id: 1,
  email: 'peder@example.com',
  name: 'Christer',
  role: 'adult',
  avatarUrl: null,
  familyId: 1,
  profileMemberId: 10,
  onboardingCompleted: true,
  synthetic: false,
};

const OWNER_USER: AuthUser = {
  ...ADULT_USER,
  role: 'owner',
};

const CHILD_USER: AuthUser = {
  ...ADULT_USER,
  id: 2,
  email: 'barn@example.com',
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
  vi.restoreAllMocks();
});

function mountCalendar(user: AuthUser = ADULT_USER): void {
  render(
    <MemoryRouter initialEntries={['/calendar']}>
      <AuthProvider initialState={{ user, isLoading: false }}>
        <Calendar />
      </AuthProvider>
    </MemoryRouter>
  );
}

function mockCalendarApi(options: {
  events?: unknown[];
  onGet?: () => unknown[];
  onPost?: (init?: RequestInit) => unknown;
  onDelete?: (url: string, init?: RequestInit) => unknown;
  getStatus?: number;
  getError?: unknown;
}): void {
  fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.startsWith('/api/integrations/calendar') || url.startsWith('/api/integrations/google-calendar')) {
      return Promise.resolve(jsonResponse(200, { integrations: [], googleConfigured: false }));
    }
    if (!url.startsWith('/api/calendar/events')) {
      return Promise.reject(new Error(`Unmocked fetch: ${url}`));
    }
    if (method === 'GET') {
      if (options.getStatus && options.getStatus >= 400) {
        return Promise.resolve(
          jsonResponse(options.getStatus, options.getError ?? { detail: 'boom' })
        );
      }
      const events = options.onGet ? options.onGet() : (options.events ?? []);
      return Promise.resolve(jsonResponse(200, { events }));
    }
    if (method === 'POST') {
      const body = options.onPost ? options.onPost(init) : { ok: true, event: { id: 99 } };
      return Promise.resolve(jsonResponse(200, body));
    }
    if (method === 'DELETE') {
      const body = options.onDelete ? options.onDelete(url, init) : { ok: true };
      return Promise.resolve(jsonResponse(200, body));
    }
    return Promise.reject(new Error(`Unmocked ${method} ${url}`));
  });
}

const SAMPLE_EVENTS = [
  {
    id: 1,
    title: 'Bursdag Lise',
    date: '2026-05-02',
    startTime: '18:00',
    endTime: null,
    location: 'Hjemme',
    allDay: false,
    notes: 'Ta med gave',
    source: 'local',
  },
  {
    id: 2,
    title: 'Legetime',
    date: '2026-05-10',
    startTime: '10:00',
    endTime: null,
    location: null,
    allDay: false,
    notes: null,
    source: 'local',
  },
];

describe('Calendar — heading and empty state', () => {
  test('renders heading from i18n', async () => {
    mockCalendarApi({ events: [] });
    mountCalendar();
    expect(screen.getByRole('heading', { name: 'Kalender', level: 1 })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('calendar-empty')).toBeInTheDocument();
    });
  });

  test('renders empty state when the range has no events', async () => {
    mockCalendarApi({ events: [] });
    mountCalendar();
    await waitFor(() => {
      expect(screen.getByTestId('calendar-empty')).toBeInTheDocument();
    });
    expect(screen.getByText('Ingen hendelser denne perioden')).toBeInTheDocument();
  });
});

describe('Calendar — source chip', () => {
  test('shows a source chip when event.source is not local', async () => {
    mockCalendarApi({
      events: [
        {
          ...SAMPLE_EVENTS[0],
          source: 'icloud',
        },
      ],
    });
    mountCalendar();
    await waitFor(() => {
      expect(screen.getByTestId('event-source-1')).toBeInTheDocument();
    });
    expect(screen.getByTestId('event-source-1')).toHaveTextContent('iCloud');
  });
});

describe('Calendar — list', () => {
  test('lists events from GET /api/calendar/events', async () => {
    mockCalendarApi({ events: SAMPLE_EVENTS });
    mountCalendar();
    await waitFor(() => {
      expect(screen.getByTestId('calendar-events')).toBeInTheDocument();
    });
    expect(screen.getByText('Bursdag Lise')).toBeInTheDocument();
    expect(screen.getByText('Legetime')).toBeInTheDocument();
    expect(screen.getByText('18:00')).toBeInTheDocument();
    expect(screen.getByText('Hjemme')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\/api\/calendar\/events\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/
      ),
      expect.objectContaining({ method: 'GET', credentials: 'include' })
    );
  });

  test('renders error card with retry on fetch failure', async () => {
    mockCalendarApi({ getStatus: 500, getError: { detail: 'boom' } });
    mountCalendar();
    await waitFor(() => {
      expect(screen.getByTestId('calendar-error')).toBeInTheDocument();
    });
    mockCalendarApi({ events: SAMPLE_EVENTS });
    fireEvent.click(screen.getByText(/Prøv igjen/));
    await waitFor(() => {
      expect(screen.getByText('Bursdag Lise')).toBeInTheDocument();
    });
  });
});

describe('Calendar — add event (adult)', () => {
  test('adult sees Add event and submitting POSTs the correct body', async () => {
    const posts: unknown[] = [];
    mockCalendarApi({
      events: [],
      onPost: (init) => {
        const parsed = init?.body ? JSON.parse(String(init.body)) : null;
        posts.push(parsed);
        return { ok: true, event: { id: 7, ...parsed } };
      },
    });
    mountCalendar(ADULT_USER);

    await waitFor(() => {
      expect(screen.getByTestId('calendar-add-form')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Legg til hendelse' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Tittel/), { target: { value: 'Fotballkamp' } });
    fireEvent.change(screen.getByLabelText(/^Dato/), { target: { value: '2026-06-15' } });
    fireEvent.change(screen.getByLabelText(/Starttid/), { target: { value: '16:30' } });
    fireEvent.change(screen.getByLabelText(/Sted/), { target: { value: 'Kunstgresset' } });
    fireEvent.change(screen.getByLabelText(/Notater/), { target: { value: 'Ta med flaske' } });
    fireEvent.click(screen.getByRole('button', { name: 'Legg til hendelse' }));

    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    expect(posts[0]).toEqual({
      title: 'Fotballkamp',
      date: '2026-06-15',
      startTime: '16:30',
      location: 'Kunstgresset',
      notes: 'Ta med flaske',
    });

    type FetchCall = [RequestInfo | URL, RequestInit | undefined];
    const calls = fetchSpy.mock.calls as unknown as FetchCall[];
    const postCall = calls.find(([, init]) => init?.method === 'POST');
    expect(postCall?.[0]).toBe('/api/calendar/events');
    expect(postCall?.[1]).toEqual(
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    );
  });

  test('owner also sees the add form', async () => {
    mockCalendarApi({ events: [] });
    mountCalendar(OWNER_USER);
    await waitFor(() => {
      expect(screen.getByTestId('calendar-add-form')).toBeInTheDocument();
    });
  });
});

describe('Calendar — child is read-only', () => {
  test('child does not see Add or Delete', async () => {
    mockCalendarApi({ events: SAMPLE_EVENTS });
    mountCalendar(CHILD_USER);
    await waitFor(() => {
      expect(screen.getByText('Bursdag Lise')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('calendar-add-form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Legg til hendelse' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Slett/ })).toBeNull();
  });
});

describe('Calendar — delete (adult)', () => {
  test('delete calls DELETE /api/calendar/events/:id', async () => {
    const deleted: string[] = [];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockCalendarApi({
      events: SAMPLE_EVENTS,
      onDelete: (url) => {
        deleted.push(url);
        return { ok: true };
      },
    });
    mountCalendar(ADULT_USER);

    await waitFor(() => {
      expect(screen.getByTestId('event-delete-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('event-delete-1'));

    await waitFor(() => {
      expect(deleted).toEqual(['/api/calendar/events/1']);
    });
    expect(window.confirm).toHaveBeenCalled();
  });

  test('cancelled confirm does not call DELETE', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockCalendarApi({ events: SAMPLE_EVENTS });
    mountCalendar(ADULT_USER);

    await waitFor(() => {
      expect(screen.getByTestId('event-delete-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('event-delete-1'));

    await waitFor(() => {
      expect(screen.getByText('Bursdag Lise')).toBeInTheDocument();
    });
    type FetchCall = [RequestInfo | URL, RequestInit | undefined];
    const calls = fetchSpy.mock.calls as unknown as FetchCall[];
    expect(calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });
});
