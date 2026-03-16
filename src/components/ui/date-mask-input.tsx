import * as React from "react";
import { Input } from "./input";
import { cn } from "@/lib/utils";

interface DateMaskInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const DateMaskInput = React.forwardRef<HTMLInputElement, DateMaskInputProps>(
  ({ className, value, onChange, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      let val = e.target.value.replace(/\D/g, ""); // Solo números
      if (val.length > 8) val = val.slice(0, 8);

      // Aplicar máscara DD/MM/YYYY
      let maskedValue = "";
      if (val.length > 0) {
        maskedValue = val.slice(0, 2);
        if (val.length > 2) {
          maskedValue += "/" + val.slice(2, 4);
          if (val.length > 4) {
            maskedValue += "/" + val.slice(4, 8);
          }
        }
      }

      // Crear un evento sintético para mantener compatibilidad con react-hook-form
      const event = {
        ...e,
        target: {
          ...e.target,
          value: maskedValue,
          name: props.name || "",
        },
      };
      onChange(event as any);
    };

    return (
      <Input
        {...props}
        ref={ref}
        value={value}
        onChange={handleChange}
        placeholder="DD/MM/YYYY"
        className={cn("font-mono", className)}
        maxLength={10}
      />
    );
  }
);

DateMaskInput.displayName = "DateMaskInput";
