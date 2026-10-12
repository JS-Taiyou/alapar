import type { Exercise } from "../lib/types";
import { formatMoney } from "../lib/format";

interface ExerciseCardProps {
  exercise: Exercise;
  monthName: string;
  personalTotal?: number;
}

export default function ExerciseCard(props: ExerciseCardProps) {
  const { exercise, monthName, personalTotal } = props;

  const totalDisplay = personalTotal !== undefined
    ? `${personalTotal >= 0 ? "+" : "-"}$${
      formatMoney(Math.abs(personalTotal))
    }`
    : `$${formatMoney(exercise.totalAmount)}`;

  return (
    <a
      href={`/dashboard/history/${exercise.id}`}
      data-exercise-card
      class="w-full flex items-center justify-between p-4 bg-surface border border-white/10 rounded-custom hover:bg-white/5 hover:translate-x-1 transition-all group text-left"
    >
      <div class="flex items-center gap-4">
        <div class="h-10 w-10 bg-white/10 rounded-custom flex items-center justify-center text-zinc-300 font-bold text-xs">
          {monthName}
        </div>
        <div>
          <p class="font-medium text-zinc-100 leading-tight">
            Corte {exercise.endDate.toLocaleDateString("es-MX", {
              month: "long",
              year: "numeric",
            })}
          </p>
          <p class="text-xs text-zinc-400">
            {exercise.transactionCount} Gastos &bull; Total: {totalDisplay}{" "}
            &bull; {exercise.endDate.toLocaleDateString("es-MX", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>
      </div>
      <svg
        class="h-5 w-5 text-zinc-500 group-hover:text-primary-light"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          d="M9 5l7 7-7 7"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
        />
      </svg>
    </a>
  );
}
