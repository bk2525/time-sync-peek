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

  // Handle OAuth callback and save Google tokens
  useEffect(() => {
    const saveGoogleTokens = async () => {
      if (user && user.app_metadata?.providers?.includes('google')) {
        console.log('User signed in with Google, checking session...');
        
        try {
          // Get the session which should contain provider tokens
          const { data: { session } } = await supabase.auth.getSession();
          console.log('Full session data:', session);
          console.log('Provider token:', session?.provider_token ? 'Present' : 'Missing');
          console.log('Provider refresh token:', session?.provider_refresh_token ? 'Present' : 'Missing');
          
          if (session?.provider_token && session?.provider_refresh_token) {
            console.log('Found Google tokens, saving...');
            
            const { data, error } = await supabase.functions.invoke('google-calendar-sync', {
              body: { 
                action: 'saveTokens', 
                accessToken: session.provider_token, 
                refreshToken: session.provider_refresh_token 
              },
            });

            console.log('Save tokens result:', { data, error });

            if (error) {
              console.error('Error saving tokens:', error);
              toast({
                title: 'Connection failed',
                description: `Failed to save Google tokens: ${error.message}`,
                variant: 'destructive',
              });
            } else if (data?.error) {
              console.error('Function returned error:', data.error);
              toast({
                title: 'Connection failed', 
                description: `Failed to save Google tokens: ${data.error}`,
                variant: 'destructive',
              });
            } else {
              setIsConnectedToGoogle(true);
              toast({
                title: 'Google Calendar connected!',
                description: 'Your calendar is now synced',
              });
            }
          } else {
            console.log('No Google provider tokens found in session');
            console.log('This likely means Google OAuth is not configured to return provider tokens');
            toast({
              title: 'Connection issue',
              description: 'Google OAuth tokens not found. Please check your Google OAuth configuration in Supabase.',
              variant: 'destructive',
            });
          }
        } catch (error) {
          console.error('Error in token saving process:', error);
          toast({
            title: 'Connection failed',
            description: 'Failed to connect Google Calendar',
            variant: 'destructive',
          });
        }
      }
    };

    if (user && !loading) {
      saveGoogleTokens();
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
