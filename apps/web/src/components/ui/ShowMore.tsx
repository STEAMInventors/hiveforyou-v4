import { Button } from "./Button";

export function ShowMore({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <Button variant="text" type="button" onClick={onClick} className="ms-[-6px] mt-2">
      {label}
    </Button>
  );
}

export function ShowFewer({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <Button variant="text" type="button" onClick={onClick} className="ms-[-6px] mt-2">
      {label}
    </Button>
  );
}