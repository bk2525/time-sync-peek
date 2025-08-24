import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, Clock, MapPin, Bell, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format, isToday, isTomorrow, parseISO } from 'date-fns';

interface Event {
  id: string;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  location: string;
  reminder_time: number;
  notification_sent: boolean;
}

export const CalendarView = () => {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const { toast } = useToast();

  const fetchEvents = async () => {
    setLoading(true);
    try {
      console.log('Fetching events...');
      
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .gte('start_time', new Date().toISOString())
        .order('start_time');

      console.log('Events fetch result:', { data, error, count: data?.length });

      if (error) throw error;
      setEvents(data || []);
    } catch (error) {
      console.error('Error fetching events:', error);
      toast({
        title: 'Error fetching events',
        description: 'Failed to load your calendar events',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const syncWithGoogle = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('google-calendar-sync', {
        body: { action: 'syncEvents' },
      });

      if (error) {
        console.error('Sync error:', error);
        throw error;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      toast({
        title: 'Calendar synced successfully',
        description: `${data.eventsCount || 0} events synchronized`,
      });

      // Wait a moment for the database to update, then refresh
      setTimeout(() => {
        fetchEvents();
      }, 1000);
    } catch (error: any) {
      console.error('Full sync error:', error);
      toast({
        title: 'Sync failed',
        description: error.message || 'Failed to sync with Google Calendar. Please sign in with Google first.',
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const getEventTimeLabel = (startTime: string) => {
    const date = parseISO(startTime);
    if (isToday(date)) return 'Today';
    if (isTomorrow(date)) return 'Tomorrow';
    return format(date, 'MMM d');
  };

  const getEventBadgeVariant = (startTime: string) => {
    const date = parseISO(startTime);
    const now = new Date();
    const diffHours = (date.getTime() - now.getTime()) / (1000 * 60 * 60);
    
    if (diffHours < 1) return 'destructive';
    if (diffHours < 24) return 'default';
    return 'secondary';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-6 w-6 text-primary" />
          <h2 className="text-2xl font-semibold">Upcoming Events</h2>
        </div>
        <Button 
          onClick={syncWithGoogle} 
          disabled={syncing}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync Calendar'}
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-muted rounded w-1/2"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : events.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No upcoming events</h3>
            <p className="text-muted-foreground mb-4">
              Sync with Google Calendar to see your events
            </p>
            <Button onClick={syncWithGoogle} disabled={syncing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {events.map((event) => (
            <Card key={event.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-lg">{event.title}</CardTitle>
                  <Badge variant={getEventBadgeVariant(event.start_time)}>
                    {getEventTimeLabel(event.start_time)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>
                      {format(parseISO(event.start_time), 'h:mm a')} - {format(parseISO(event.end_time), 'h:mm a')}
                    </span>
                  </div>
                  
                  {event.location && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                      <span>{event.location}</span>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Bell className="h-4 w-4" />
                    <span>Reminder: {event.reminder_time} minutes before</span>
                    {event.notification_sent && (
                      <Badge variant="outline" className="text-xs">Sent</Badge>
                    )}
                  </div>
                  
                  {event.description && (
                    <p className="text-sm text-muted-foreground mt-2">
                      {event.description}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};