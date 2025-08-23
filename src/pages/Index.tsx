import { useAuth } from '@/hooks/useAuth';
import { AuthPage } from '@/components/auth/AuthPage';
import { Navbar } from '@/components/Navbar';
import { CalendarView } from '@/components/CalendarView';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const Index = () => {
  const { user, loading } = useAuth();
  const [isConnectedToGoogle, setIsConnectedToGoogle] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // Check if user has Google tokens after OAuth
    const checkGoogleConnection = async () => {
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('google_access_token')
          .eq('user_id', user.id)
          .single();

        setIsConnectedToGoogle(!!profile?.google_access_token);
      }
    };

    checkGoogleConnection();
  }, [user]);

  // Handle OAuth callback and token extraction
  useEffect(() => {
    const handleOAuthCallback = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const accessToken = urlParams.get('access_token');
      const refreshToken = urlParams.get('refresh_token');

      console.log('OAuth callback check:', { 
        hasAccessToken: !!accessToken, 
        hasRefreshToken: !!refreshToken,
        userId: user?.id 
      });

      if (accessToken && refreshToken && user) {
        try {
          console.log('Saving Google tokens...');
          const { data, error } = await supabase.functions.invoke('google-calendar-sync', {
            body: { 
              action: 'saveTokens', 
              accessToken, 
              refreshToken 
            },
          });

          console.log('Save tokens result:', { data, error });

          if (error) {
            console.error('Error saving tokens:', error);
            throw error;
          }

          setIsConnectedToGoogle(true);
          toast({
            title: 'Google Calendar connected!',
            description: 'Your calendar is now synced',
          });

          // Clean up URL
          window.history.replaceState({}, document.title, '/');
        } catch (error) {
          console.error('Error saving tokens:', error);
          toast({
            title: 'Connection failed',
            description: 'Failed to connect Google Calendar',
            variant: 'destructive',
          });
        }
      }
    };

    if (user && !loading) {
      handleOAuthCallback();
    }
  }, [user, loading, toast]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-8">
        <CalendarView />
      </main>
    </div>
  );
};

export default Index;
