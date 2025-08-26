import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Check required environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
    const googleClientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const googleClientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');

    console.log('Environment check:', {
      supabaseUrl: !!supabaseUrl,
      supabaseKey: !!supabaseKey,
      googleClientId: !!googleClientId,
      googleClientSecret: !!googleClientSecret
    });

    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase environment variables');
      return new Response(JSON.stringify({ error: 'Server configuration error: Missing Supabase credentials' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!googleClientId || !googleClientSecret) {
      console.error('Missing Google environment variables');
      return new Response(JSON.stringify({ error: 'Server configuration error: Missing Google credentials' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      supabaseUrl,
      supabaseKey,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('Unauthorized: No user found');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Processing request for user:', user.id);

    const requestBody = await req.json();
    const { action, accessToken, refreshToken } = requestBody;
    
    console.log('Request action:', action);

    if (action === 'saveTokens') {
      console.log('Saving Google OAuth tokens for user:', user.id);
      
      if (!accessToken) {
        return new Response(JSON.stringify({ error: 'Access token is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Save Google OAuth tokens to user profile
      const { error } = await supabase
        .from('profiles')
        .upsert({
          user_id: user.id,
          email: user.email,
          google_access_token: accessToken,
          google_refresh_token: refreshToken,
          google_token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

      if (error) {
        console.error('Error saving tokens:', error);
        return new Response(JSON.stringify({ 
          error: 'Failed to save tokens', 
          details: error.message 
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log('Tokens saved successfully');
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'syncEvents') {
      console.log('Starting syncEvents for user:', user.id);
      
      // Get user's Google tokens
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('google_access_token, google_refresh_token, google_token_expires_at')
        .eq('user_id', user.id)
        .single();

      console.log('Profile query result:', { 
        hasProfile: !!profile, 
        hasAccessToken: !!profile?.google_access_token,
        hasRefreshToken: !!profile?.google_refresh_token,
        profileError 
      });

      if (profileError) {
        console.error('Profile fetch error:', profileError);
        return new Response(JSON.stringify({ 
          error: 'Failed to fetch user profile', 
          details: profileError.message 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!profile?.google_access_token) {
        console.log('No Google access token found for user');
        return new Response(JSON.stringify({ 
          error: 'No Google access token found. Please connect your Google Calendar first.' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check if token needs refresh
      let accessToken = profile.google_access_token;
      const tokenExpired = profile.google_token_expires_at && 
        new Date() >= new Date(profile.google_token_expires_at);

      if (tokenExpired && profile.google_refresh_token) {
        console.log('Token expired, refreshing...');
        
        try {
          const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: googleClientId,
              client_secret: googleClientSecret,
              refresh_token: profile.google_refresh_token,
              grant_type: 'refresh_token',
            }),
          });

          console.log('Refresh response status:', refreshResponse.status);
          
          if (!refreshResponse.ok) {
            const errorText = await refreshResponse.text();
            console.error('Token refresh failed:', errorText);
            return new Response(JSON.stringify({ 
              error: 'Failed to refresh Google access token. Please reconnect your Google Calendar.',
              details: errorText
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          const refreshData = await refreshResponse.json();
          console.log('Token refreshed successfully');
          
          if (refreshData.access_token) {
            accessToken = refreshData.access_token;
            // Update stored token
            const { error: updateError } = await supabase
              .from('profiles')
              .update({
                google_access_token: accessToken,
                google_token_expires_at: new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq('user_id', user.id);

            if (updateError) {
              console.error('Failed to update refreshed token:', updateError);
            }
          } else {
            console.error('No access token in refresh response:', refreshData);
            return new Response(JSON.stringify({ 
              error: 'Failed to refresh Google access token. Please reconnect your Google Calendar.' 
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } catch (refreshError) {
          console.error('Token refresh exception:', refreshError);
          return new Response(JSON.stringify({ 
            error: 'Failed to refresh Google access token. Please reconnect your Google Calendar.',
            details: refreshError.message
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else if (tokenExpired) {
        console.log('Token expired and no refresh token available');
        return new Response(JSON.stringify({ 
          error: 'Google access token expired and no refresh token available. Please reconnect your Google Calendar.' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else {
        console.log('Token is still valid');
      }

      // Fetch events from Google Calendar
      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // Extended to 30 days

      console.log('Calendar API request:', {
        timeMin,
        timeMax,
        url: `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=50`
      });

      try {
        // First, let's check what calendars the user has access to
        const calendarsResponse = await fetch(
          'https://www.googleapis.com/calendar/v3/users/me/calendarList',
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        if (calendarsResponse.ok) {
          const calendarsData = await calendarsResponse.json();
          console.log('Available calendars:', calendarsData.items?.map(cal => ({
            id: cal.id,
            summary: cal.summary,
            primary: cal.primary
          })));
        }

        // Now fetch events from primary calendar
        const calendarResponse = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=50`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        console.log('Calendar API response:', {
          status: calendarResponse.status,
          statusText: calendarResponse.statusText,
          headers: Object.fromEntries(calendarResponse.headers.entries())
        });

        const calendarData = await calendarResponse.json();
        
        console.log('Calendar API data:', {
          totalItems: calendarData.items?.length || 0,
          hasNextPageToken: !!calendarData.nextPageToken,
          summary: calendarData.summary,
          timeZone: calendarData.timeZone,
          firstFewEvents: calendarData.items?.slice(0, 3)?.map(e => ({
            id: e.id,
            summary: e.summary,
            start: e.start,
            end: e.end,
            hasDateTime: !!e.start?.dateTime
          }))
        });
        
        if (!calendarResponse.ok) {
          console.error('Calendar API error details:', calendarData);
          return new Response(JSON.stringify({ 
            error: 'Failed to fetch calendar events',
            details: calendarData,
            apiStatus: calendarResponse.status
          }), {
            status: calendarResponse.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Save events to database
        const events = calendarData.items || [];
        let savedEventsCount = 0;
        let skippedEventsCount = 0;
        const saveErrors = [];

        console.log(`Processing ${events.length} events from Google Calendar`);

        for (const event of events) {
          console.log('Processing event:', {
            id: event.id,
            summary: event.summary,
            hasStartDateTime: !!event.start?.dateTime,
            startDate: event.start?.date,
            startDateTime: event.start?.dateTime
          });

          if (!event.start?.dateTime && !event.start?.date) {
            skippedEventsCount++;
            console.log('Skipped event (no start time):', event.id);
            continue;
          }

          try {
            const startTime = event.start.dateTime || event.start.date;
            const endTime = event.end?.dateTime || event.end?.date || startTime;

            const { error: eventError, data: eventData } = await supabase
              .from('events')
              .upsert({
                user_id: user.id,
                google_event_id: event.id,
                title: event.summary || 'Untitled Event',
                description: event.description || '',
                start_time: startTime,
                end_time: endTime,
                location: event.location || '',
                updated_at: new Date().toISOString()
              }, { onConflict: 'google_event_id' });

            if (eventError) {
console.log('EXACT SAVE ERROR:', JSON.stringify({
  eventId: event.id,
  error: eventError,
  userData: { user_id: user.id, email: user.email }
}, null, 2));              saveErrors.push({ eventId: event.id, error: eventError });
            } else {
              savedEventsCount++;
              console.log('Successfully saved event:', event.id);
            }
          } catch (eventSaveError) {
            console.error('Exception saving event:', event.id, eventSaveError);
            saveErrors.push({ eventId: event.id, error: eventSaveError.message });
          }
        }

        console.log('Final results:', {
          totalEventsFromGoogle: events.length,
          savedEventsCount,
          skippedEventsCount,
          saveErrorsCount: saveErrors.length,
          saveErrors: saveErrors.slice(0, 3) // First 3 errors
        });

        return new Response(JSON.stringify({ 
          success: true, 
          eventsCount: savedEventsCount,
          totalEvents: events.length,
          skippedEvents: skippedEventsCount,
          saveErrors: saveErrors.length,
          debug: {
            timeRange: { timeMin, timeMax },
            calendarSummary: calendarData.summary,
            firstEventSample: events[0] ? {
              summary: events[0].summary,
              start: events[0].start
            } : null
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

      } catch (calendarError) {
        console.error('Calendar fetch exception:', calendarError);
        return new Response(JSON.stringify({ 
          error: 'Failed to fetch calendar events',
          details: calendarError.message
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in google-calendar-sync function:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      details: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});