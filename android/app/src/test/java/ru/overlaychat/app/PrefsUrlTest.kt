package ru.overlaychat.app

import org.junit.Assert.assertEquals
import org.junit.Test

class PrefsUrlTest {
    @Test
    fun trimTrailingSlashLogic() {
        fun norm(v: String) = v.trim().trimEnd('/')
        assertEquals("http://example.ru:3000", norm(" http://example.ru:3000/ "))
        assertEquals("https://chat.example.ru", norm("https://chat.example.ru/"))
    }
}
