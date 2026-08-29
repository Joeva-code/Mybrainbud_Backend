export interface RegisterDto {
  firstName: string;
  lastName?: string;
  email: string;
  password: string;
  role?: "STUDENT" | "PARENT" | "TEACHER" | "SCHOOL_ADMIN" | "ADMIN";
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
  role: string;
  isVerified: boolean;
  isActive: boolean;
}

export interface AuthResponse {
  user: UserProfile;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  sessionId: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
