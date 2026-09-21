import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import type { UserProfile, UserRole } from "../types";

interface AuthContextValue {
  client: SupabaseClient | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  configured: boolean;
  profileError: string | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    let active = true;
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        setSession(error ? null : data.session);
        setAuthLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        setAuthLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !session) {
      setProfile(null);
      setProfileError(null);
      setProfileLoading(false);
      return;
    }

    let active = true;
    setProfileLoading(true);
    setProfileError(null);

    supabase
      .from("users")
      .select("id, student_id, name, department_id, phone, email, position, notes, role, is_active")
      .eq("auth_user_id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data) {
          setProfile(null);
          setProfileError(error?.message ?? "账户尚未关联仓库用户资料。请联系管理员。");
        } else {
          setProfile({
            id: data.id,
            studentId: data.student_id,
            name: data.name,
            departmentId: data.department_id,
            phone: data.phone,
            email: data.email,
            position: data.position,
            notes: data.notes,
            role: data.role as UserRole,
            isActive: data.is_active,
          });
        }
        setProfileLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session]);

  const loading = authLoading || (Boolean(session) && profileLoading);

  const value = useMemo(
    () => ({ client: supabase, session, profile, loading, configured: isSupabaseConfigured, profileError }),
    [session, profile, loading, profileError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
