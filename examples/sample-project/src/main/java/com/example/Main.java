package com.example;

import java.util.List;
import java.util.ArrayList;

/**
 * Simple demonstration main class.
 * Calculates the sum of a list of integers.
 */
public class Main {

    public static void main(String[] args) {
        List<Integer> numbers = new ArrayList<>();
        for (String arg : args) {
            try {
                numbers.add(Integer.parseInt(arg));
            } catch (NumberFormatException e) {
                System.err.println("Skipping invalid number: " + arg);
            }
        }

        int total = sum(numbers);
        System.out.println("Sum: " + total);
    }

    /**
     * Sums a list of integers.
     * @param numbers the list to sum
     * @return the total
     */
    public static int sum(List<Integer> numbers) {
        if (numbers == null || numbers.isEmpty()) {
            return 0;
        }
        return numbers.stream().mapToInt(Integer::intValue).sum();
    }
}
