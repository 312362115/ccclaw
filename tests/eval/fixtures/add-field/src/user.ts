export interface User {
  id: number;
  name: string;
  email: string;
}

export function createUser(name: string, email: string): User {
  return { id: Date.now(), name, email };
}

export function formatUser(user: User): string {
  return `${user.name} <${user.email}>`;
}
