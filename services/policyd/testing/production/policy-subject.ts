export interface PolicySubject {
  readonly kind: "principal" | "group";
  readonly id: string;
}
