import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export const AuthCallback = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
          throw error;
        }

        if (data.session) {
          // Get the provider token (Google tokens)
          const providerToken = data.session.provider_token;
          const providerRefreshToken = data.session.provider_refresh_token;
          
          if (providerToken) {
            // Save tokens to profiles table
            const { error: profileError } = await supabase
              .from('profiles')
              .upsert({
                user_id: data.session.user.id,
                email: data.session.user.email,
                display_name: data.session.user.user_metadata.full_name,
                google_access_token: providerToken,
                google_refresh_token: providerRefreshToken,
                google_token_expires_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
                updated_at: new Date().toISOString()
              });

            if (profileError) {
              console.error('Failed to save tokens:', profileError);
              toast({
                title: 'Token save failed',
                description: 'Failed to save Google tokens. Please try again.',
                variant: 'destructive',
              });
            } else {
              toast({
                title: 'Success!',
                description: 'Successfully connected to Google Calendar',
              });
            }
          }
          
          navigate('/');
        } else {
          navigate('/');
        }
      } catch (error: any) {
        console.error('Auth callback error:', error);
        toast({
          title: 'Authentication failed',
          description: error.message || 'An error occurred during authentication',
          variant: 'destructive',
        });
        navigate('/');
      }
    };

    handleAuthCallback();
  }, [navigate, toast]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary mx-auto"></div>
        <p className="mt-4 text-lg">Completing authentication...</p>
      </div>
    </div>
  );
};