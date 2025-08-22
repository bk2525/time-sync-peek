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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Get events that need reminders (within reminder time and not yet sent)
    const now = new Date();
    const { data: events, error } = await supabase
      .from('events')
      .select(`
        *,
        profiles!inner(display_name, email)
      `)
      .eq('notification_sent', false)
      .lte('start_time', new Date(now.getTime() + 60 * 60 * 1000).toISOString()) // Next hour
      .gte('start_time', now.toISOString());

    if (error) {
      console.error('Error fetching events:', error);
      return new Response(JSON.stringify({ error: 'Failed to fetch events' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let sentCount = 0;

    for (const event of events || []) {
      const reminderTime = new Date(event.start_time);
      reminderTime.setMinutes(reminderTime.getMinutes() - (event.reminder_time || 15));

      if (now >= reminderTime) {
        // Send web push notification (placeholder - would need proper push service)
        console.log(`Reminder for event: ${event.title} at ${event.start_time}`);
        
        // Mark as sent
        await supabase
          .from('events')
          .update({ notification_sent: true })
          .eq('id', event.id);

        sentCount++;
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      reminders_sent: sentCount 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in send-reminders function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});