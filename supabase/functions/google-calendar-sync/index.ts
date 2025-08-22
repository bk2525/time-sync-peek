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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { action, accessToken, refreshToken } = await req.json();

    if (action === 'saveTokens') {
      // Save Google OAuth tokens to user profile
      const { error } = await supabase
        .from('profiles')
        .upsert({
          user_id: user.id,
          email: user.email,
          google_access_token: accessToken,
          google_refresh_token: refreshToken,
          google_token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        });

      if (error) {
        console.error('Error saving tokens:', error);
        return new Response(JSON.stringify({ error: 'Failed to save tokens' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'syncEvents') {
      // Get user's Google tokens
      const { data: profile } = await supabase
        .from('profiles')
        .select('google_access_token, google_refresh_token, google_token_expires_at')
        .eq('user_id', user.id)
        .single();

      if (!profile?.google_access_token) {
        return new Response(JSON.stringify({ error: 'No Google access token found' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check if token needs refresh
      let accessToken = profile.google_access_token;
      if (new Date() >= new Date(profile.google_token_expires_at)) {
        // Refresh token
        const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
            client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
            refresh_token: profile.google_refresh_token,
            grant_type: 'refresh_token',
          }),
        });

        const refreshData = await refreshResponse.json();
        if (refreshData.access_token) {
          accessToken = refreshData.access_token;
          // Update stored token
          await supabase
            .from('profiles')
            .update({
              google_access_token: accessToken,
              google_token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
            })
            .eq('user_id', user.id);
        }
      }

      // Fetch events from Google Calendar
      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // Next 7 days

      const calendarResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      const calendarData = await calendarResponse.json();
      
      if (!calendarResponse.ok) {
        console.error('Calendar API error:', calendarData);
        return new Response(JSON.stringify({ error: 'Failed to fetch calendar events' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Save events to database
      const events = calendarData.items || [];
      const eventPromises = events.map(async (event: any) => {
        if (!event.start?.dateTime) return null;

        return supabase
          .from('events')
          .upsert({
            user_id: user.id,
            google_event_id: event.id,
            title: event.summary || 'Untitled Event',
            description: event.description || '',
            start_time: event.start.dateTime,
            end_time: event.end?.dateTime || event.start.dateTime,
            location: event.location || '',
          }, { onConflict: 'google_event_id' });
      });

      await Promise.all(eventPromises.filter(Boolean));

      return new Response(JSON.stringify({ 
        success: true, 
        eventsCount: events.filter((e: any) => e.start?.dateTime).length 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in google-calendar-sync function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});