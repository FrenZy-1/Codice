package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import java.util.Arrays;

class MainTest {

    @Test
    void sumOfEmptyList() {
        assertEquals(0, Main.sum(List.of()));
    }

    @Test
    void sumOfSingleElement() {
        assertEquals(42, Main.sum(List.of(42)));
    }

    @Test
    void sumOfMultipleElements() {
        assertEquals(15, Main.sum(Arrays.asList(1, 2, 3, 4, 5)));
    }

    @Test
    void sumOfNullList() {
        assertEquals(0, Main.sum(null));
    }
}
