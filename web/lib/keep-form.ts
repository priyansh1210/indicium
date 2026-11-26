import { startTransition, type FormEvent } from "react";

/** Submit a form to its action without React's reset afterwards, so a refused submission keeps
 *  everything typed into a long form. Use as onSubmit, with the action from useActionState. */
export function keepForm(action: (form: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(() => action(form));
  };
}
